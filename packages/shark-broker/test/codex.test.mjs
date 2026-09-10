import assert from "node:assert/strict";
import test from "node:test";
import { CodexAdapter } from "../src/adapters/codex.mjs";
import { validateSession } from "../src/session.mjs";
import { completion, fixture } from "./fixture.mjs";

export const codexSession = {
  version: 1,
  harness: "codex",
  sessionId: "11111111-1111-7111-8111-111111111111",
  cwd: "/synthetic/project",
  adapterData: { socketPath: "/synthetic/owner.sock" },
};
const input = {
  id: "msg_shark_synthetic",
  text: "Reply: $(do-not-run)\n`literal`",
  delivery: "queue",
};
function native() {
  const state = {
    sends: 0,
    closed: 0,
    messages: [],
    queue: [],
    calls: [],
    status: "idle",
    available: true,
  };
  const rpc = {
    close: () => state.closed++,
    request: async (method, params) => {
      state.calls.push({ method, params });
      if (method === "thread/read")
        return {
          thread: {
            id: codexSession.sessionId,
            cwd: codexSession.cwd,
            createdAt: 123,
            ephemeral: false,
            canAcceptDirectInput: state.available,
            status: { type: state.status },
            ...state.thread,
          },
        };
      if (method === "thread/queue/add") {
        state.sends++;
        if (state.onSend) return state.onSend(params);
        state.queue.push({
          id: "queue-synthetic",
          clientUserMessageId: params.clientUserMessageId,
          input: params.input,
        });
        return { queuedSubmission: state.queue.at(-1) };
      }
      if (method === "thread/queue/list") return { data: state.queue, nextCursor: null };
      if (method === "thread/turns/list") {
        if (state.history) return state.history(params);
        return {
          data: [{ id: "turn-synthetic", itemsView: "full", items: state.messages }],
          nextCursor: null,
        };
      }
      throw new Error(`Unexpected mutation: ${method}`);
    },
  };
  const adapter = new CodexAdapter({ connect: async () => rpc });
  return { state, adapter, rpc };
}

test("Codex references pin an exact UUID and local owner; arbitrary connection/command fields fail", () => {
  assert.deepEqual(validateSession(codexSession), codexSession);
  for (const change of [
    { sessionId: "latest" },
    { sessionId: [] },
    { cwd: "relative" },
    { generation: -1 },
    { adapterData: { socketPath: "relative" } },
    { adapterData: { socketPath: "/owner.sock", command: "anything" } },
  ])
    assert.throws(() => validateSession({ ...codexSession, ...change }));
});

test("Codex probe requires a loaded writable persistent owner and pins native identity", async () => {
  const { adapter, state } = native();
  assert.deepEqual((await adapter.probe(codexSession)).session, {
    ...codexSession,
    generation: 123,
  });
  for (const thread of [
    { id: "other" },
    { ephemeral: true },
    { canAcceptDirectInput: null },
    { status: { type: "notLoaded" } },
    { cwd: "/moved" },
    { createdAt: "bad" },
  ]) {
    state.thread = thread;
    assert.equal((await adapter.probe(codexSession)).status, "unknown");
  }
  state.thread = {};
  assert.equal((await adapter.probe({ ...codexSession, generation: 456 })).status, "unknown");
  assert.equal(state.sends, 0);
});

test("Codex completion reply uses queue admission, literal text, durable barrier and readback receipt", async () => {
  const { adapter, state } = native();
  let barrier = false;
  state.onSend = (params) => {
    assert.equal(barrier, true);
    assert.deepEqual(params, {
      threadId: codexSession.sessionId,
      clientUserMessageId: input.id,
      input: [{ type: "text", text: input.text, text_elements: [] }],
    });
    state.queue.push({ id: "queue-1", clientUserMessageId: input.id, input: params.input });
    return {};
  };
  const result = await adapter.deliver(codexSession, input, {
    beforeSend: async () => {
      barrier = true;
    },
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(result.receipt, {
    threadId: codexSession.sessionId,
    clientId: input.id,
    queueId: "queue-1",
    location: "queue",
  });
  assert.equal(state.sends, 1);
  assert.equal(state.closed, 1);
  assert.equal((await adapter.deliver(codexSession, input)).status, "accepted");
  assert.equal((await adapter.deliver(codexSession, { ...input, id: "new-id" })).status, "unknown");
  assert.equal(state.sends, 1);
});

test("Codex acknowledgement alone and lost responses remain unknown; reconciliation only reads", async () => {
  for (const lost of [false, true]) {
    const { adapter, state } = native();
    state.onSend = () => {
      if (lost) throw new Error("lost");
      return { queuedSubmission: { id: "ack-only" } };
    };
    assert.equal(
      (await adapter.deliver(codexSession, input, { beforeSend: async () => {} })).status,
      "unknown",
    );
    assert.equal((await adapter.reconcile(codexSession, input)).status, "unknown");
    assert.equal(state.sends, 1);
    state.messages = [
      {
        type: "userMessage",
        id: "item-1",
        clientId: input.id,
        content: [{ type: "text", text: input.text }],
      },
    ];
    const result = await adapter.reconcile(codexSession, input);
    assert.equal(result.status, "accepted");
    assert.equal(result.receipt.itemId, "item-1");
    assert.equal(state.sends, 1);
  }
});

test("Codex history pagination checks all pages; conflicting/duplicate IDs are not accepted", async () => {
  const { adapter, state } = native();
  const match = {
    type: "userMessage",
    id: "item-1",
    clientId: input.id,
    content: [{ type: "text", text: input.text }],
  };
  state.history = ({ cursor }) => ({
    data: [{ id: cursor ? "turn-2" : "turn-1", itemsView: "full", items: cursor ? [match] : [] }],
    nextCursor: cursor ? null : "page-2",
  });
  assert.equal((await adapter.reconcile(codexSession, input)).status, "accepted");
  state.history = undefined;
  for (const messages of [
    [match, { ...match, id: "item-2" }],
    [{ ...match, content: [{ type: "text", text: "different" }] }],
  ]) {
    state.messages = messages;
    assert.equal((await adapter.reconcile(codexSession, input)).status, "conflict");
  }
  state.messages = [match];
  state.queue = [{ id: "queue-1", clientUserMessageId: input.id, input: match.content }];
  assert.equal((await adapter.reconcile(codexSession, input)).status, "unknown");
  assert.equal(state.sends, 0);
});

test("Codex incomplete or looping history never produces a positive receipt", async () => {
  const { adapter, state } = native();
  for (const result of [
    { data: [{ id: "turn", itemsView: "summary", items: [] }], nextCursor: null },
    { data: [], nextCursor: "loop" },
    { data: [] },
  ]) {
    state.history = () => result;
    assert.equal((await adapter.reconcile(codexSession, input)).status, "unknown");
  }
});

test("broker recovers a Codex reply after crash without a second queue insertion", async (t) => {
  const f = await fixture(t);
  const { adapter, state } = native();
  let crash = true;
  const broker = f.broker({
    adapter,
    checkpoint: async (point) => {
      if (point === "after_admission" && crash) {
        crash = false;
        throw new Error("synthetic crash");
      }
    },
  });
  const result = await broker.register({ ...completion(), session: codexSession });
  f.answer(result.id);
  f.advance(60_000);
  await assert.rejects(broker.process(result.id), /synthetic crash/);
  assert.equal(f.store.get(result.id).data.nativeAttempted, true);
  assert.equal(state.sends, 1);
  const recovered = await f.broker({ store: await f.open(), adapter }).process(result.id);
  assert.equal(recovered.state, "delivered");
  assert.equal(state.sends, 1);
  assert.equal(f.store.get(result.id).data.nativeReceipt.location, "queue");
});

test("broker persists uncertain Codex delivery, notifies recovery once, and manual retry only reconciles", async (t) => {
  const f = await fixture(t);
  const { adapter, state } = native();
  state.onSend = () => {
    throw new Error("lost");
  };
  const broker = f.broker({ adapter });
  const result = await broker.register({ ...completion(), session: codexSession });
  f.answer(result.id);
  f.advance(60_000);
  assert.equal((await broker.process(result.id)).state, "unknown");
  assert.equal(state.sends, 1);
  f.advance(3_600_000);
  await broker.tick();
  assert.equal(state.sends, 1);
  assert.equal((await broker.retry(result.id)).state, "unknown");
  assert.equal(state.sends, 1);
  const stored = f.store.get(result.id);
  state.messages = [
    {
      type: "userMessage",
      id: "saved-item",
      clientId: stored.data.nativeInput.id,
      content: [{ type: "text", text: stored.data.nativeInput.text }],
    },
  ];
  assert.equal((await broker.retry(result.id)).state, "delivered");
  assert.equal(state.sends, 1);
  assert.equal(f.store.list().filter((row) => row.kind === "notification").length, 1);
});

test("broker never retries after a crash between durable Codex barrier and socket write", async (t) => {
  const f = await fixture(t);
  const { adapter, state } = native();
  const broker = f.broker({
    adapter,
    checkpoint: async (point) => {
      if (point === "codex_before_submit") throw new Error("synthetic stop before write");
    },
  });
  const result = await broker.register({ ...completion(), session: codexSession });
  f.answer(result.id);
  f.advance(60_000);
  assert.equal((await broker.process(result.id)).state, "unknown");
  assert.equal(state.sends, 0);
  assert.equal((await f.broker({ adapter }).retry(result.id)).state, "unknown");
  assert.equal(state.sends, 0);
});

test("Codex active-request registration fails before creating a phone interaction", async (t) => {
  const f = await fixture(t);
  const { adapter } = native();
  await assert.rejects(
    f.broker({ adapter }).registerActive({
      session: codexSession,
      kind: "permission",
      requestID: "request",
      prompt: "Approve?",
      idempotencyKey: "active",
    }),
    /codex_active_requests_unsupported/,
  );
  assert.equal(f.state.createCalls, 0);
});

test("Codex recovery after its old notice is pruned stays unknown without recreating the notice", async (t) => {
  const f = await fixture(t);
  const { adapter, state } = native();
  state.onSend = () => {
    throw new Error("lost");
  };
  const broker = f.broker({ adapter });
  const result = await broker.register({ ...completion(), session: codexSession });
  f.answer(result.id);
  f.advance(60_000);
  await broker.process(result.id);
  await broker.tick();
  assert.equal(f.store.list().filter((row) => row.kind === "notification").length, 1);
  f.advance(8 * 86_400_000);
  await broker.tick();
  assert.equal(f.store.list().filter((row) => row.kind === "notification").length, 0);
  assert.equal((await broker.retry(result.id)).state, "unknown");
  assert.equal(f.store.list().filter((row) => row.kind === "notification").length, 0);
  assert.equal(state.sends, 1);
});
