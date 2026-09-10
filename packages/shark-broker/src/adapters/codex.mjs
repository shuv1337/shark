import { BrokerError } from "../errors.mjs";
import { stableJSON } from "../json.mjs";
import { validateSession } from "../session.mjs";
import { connectCodex } from "./codex-rpc.mjs";

const unknown = (reason = "codex_admission_unconfirmed") => ({ status: "unknown", reason });
const exactText = (content, text) =>
  Array.isArray(content) &&
  content.length === 1 &&
  content[0].type === "text" &&
  content[0].text === text &&
  (content[0].text_elements === undefined || content[0].text_elements.length === 0);

export class CodexAdapter {
  retrySafe = false;
  constructor({ connect = connectCodex, timeout = 20_000, maxPages = 100 } = {}) {
    Object.assign(this, { connect, timeout, maxPages });
  }
  async using(session, operation) {
    let rpc, timer;
    try {
      const ref = validateSession(session);
      if (ref.harness !== "codex") throw new BrokerError(2, "unsupported_harness");
      rpc = await this.connect(ref);
      timer = setTimeout(() => rpc.close(), this.timeout);
      return await operation(rpc, ref);
    } catch {
      return unknown("codex_owner_unavailable");
    } finally {
      clearTimeout(timer);
      rpc?.close();
    }
  }
  async snapshot(rpc, session) {
    const { thread } = await rpc.request("thread/read", { threadId: session.sessionId });
    if (
      thread?.id !== session.sessionId ||
      !Number.isSafeInteger(thread.createdAt) ||
      typeof thread.cwd !== "string" ||
      !thread.cwd.startsWith("/")
    )
      return unknown("codex_snapshot_invalid");
    if (session.generation !== undefined && session.generation !== thread.createdAt)
      return unknown("session_generation_changed");
    if (session.cwd !== undefined && session.cwd !== thread.cwd) return unknown("session_moved");
    if (
      thread.ephemeral !== false ||
      thread.canAcceptDirectInput !== true ||
      !["idle", "active"].includes(thread.status?.type)
    )
      return unknown("codex_owner_not_loaded");
    // Disk-only projections cannot prove a live writer is gone. Never infer missing.
    return {
      status: "available",
      session: validateSession({ ...session, cwd: thread.cwd, generation: thread.createdAt }),
    };
  }
  probe(session) {
    return this.using(session, (rpc, ref) => this.snapshot(rpc, ref));
  }

  async *pages(rpc, method, params) {
    const seen = new Set();
    let cursor;
    for (let page = 0; page < this.maxPages; page++) {
      const result = await rpc.request(method, {
        ...params,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      if (
        !Array.isArray(result?.data) ||
        !(result.nextCursor === null || typeof result.nextCursor === "string")
      )
        throw new BrokerError(6, "codex_history_incomplete");
      if (result.nextCursor !== null) {
        if (!result.nextCursor || seen.has(result.nextCursor))
          throw new BrokerError(6, "codex_history_incomplete");
        seen.add(result.nextCursor);
      }
      yield* result.data;
      if (result.nextCursor === null) return;
      cursor = result.nextCursor;
    }
    throw new BrokerError(6, "codex_history_incomplete");
  }
  async readback(rpc, session, input) {
    const params = { threadId: session.sessionId };
    const rawMessages = [];
    for await (const turn of this.pages(rpc, "thread/turns/list", {
      ...params,
      itemsView: "full",
    })) {
      if (!Array.isArray(turn.items) || turn.itemsView !== "full")
        return unknown("codex_history_incomplete");
      for (const item of turn.items)
        if (item.type === "userMessage" && item.clientId === input.id)
          rawMessages.push({ turnId: turn.id, itemId: item.id, content: item.content });
    }
    const messages = [];
    const messagesByIdentity = new Map();
    let conflictingDuplicate = false;
    for (const message of rawMessages) {
      const identity = `${message.turnId}\u0000${message.itemId}`;
      const previous = messagesByIdentity.get(identity);
      if (previous) {
        if (stableJSON(previous.content) !== stableJSON(message.content))
          conflictingDuplicate = true;
      } else {
        messagesByIdentity.set(identity, message);
        messages.push(message);
      }
    }
    const rawQueue = [];
    for await (const entry of this.pages(rpc, "thread/queue/list", params)) {
      if (entry.clientUserMessageId === input.id) rawQueue.push(entry);
    }
    const queue = [];
    const queueByIdentity = new Map();
    for (const entry of rawQueue) {
      const previous = queueByIdentity.get(entry.id);
      if (previous) {
        if (stableJSON(previous.input) !== stableJSON(entry.input)) conflictingDuplicate = true;
      } else {
        queueByIdentity.set(entry.id, entry);
        queue.push(entry);
      }
    }
    if (
      conflictingDuplicate ||
      messages.length > 1 ||
      queue.length > 1 ||
      messages.some((item) => !exactText(item.content, input.text)) ||
      queue.some((item) => !exactText(item.input, input.text))
    )
      return { status: "conflict" };
    // A queue-to-history transition can appear in both non-atomic reads. Do not
    // guess which copy is authoritative or mark duplicate delivery as success.
    if (messages.length && queue.length) return unknown("codex_snapshot_transition");
    const match = messages[0] ?? queue[0];
    if (!match) return { status: "absent" };
    if (typeof (match.itemId ?? match.id) !== "string") return unknown();
    return {
      status: "accepted",
      receipt: {
        threadId: session.sessionId,
        clientId: input.id,
        ...(messages.length
          ? { turnId: match.turnId, itemId: match.itemId, location: "history" }
          : { queueId: match.id, location: "queue" }),
      },
    };
  }
  reconcile(session, input) {
    return this.using(session, async (rpc, ref) => {
      const probe = await this.snapshot(rpc, ref);
      if (probe.status !== "available") return probe;
      const result = await this.readback(rpc, ref, input);
      return result.status === "absent" ? unknown() : result;
    });
  }
  deliver(session, input, { beforeSend } = {}) {
    return this.using(session, async (rpc, ref) => {
      const probe = await this.snapshot(rpc, ref);
      if (probe.status !== "available") return probe;
      // Detect an earlier native admission even if this host's broker database
      // was restored or replaced. Also prove readback is supported before sending.
      const existing = await this.readback(rpc, ref, input);
      if (existing.status !== "absent") return existing;
      // The broker supplies this durable barrier. Direct adapter use cannot send.
      if (typeof beforeSend !== "function") return unknown("codex_durable_barrier_required");
      await beforeSend();
      try {
        await rpc.request("thread/queue/add", {
          threadId: ref.sessionId,
          clientUserMessageId: input.id,
          input: [{ type: "text", text: input.text, text_elements: [] }],
        });
      } catch {
        return unknown();
      }
      // An acknowledgement alone is not a persisted admission receipt.
      const result = await this.readback(rpc, ref, input);
      return result.status === "absent" ? unknown() : result;
    });
  }
  async receipt() {
    throw new BrokerError(2, "codex_active_requests_unsupported");
  }
}
