import { createHash, randomUUID } from "node:crypto";
import { AdapterRouter } from "./adapters/index.mjs";
import { completion, expiry, selectDevices, text } from "./content.mjs";
import { BrokerError, requireValue } from "./errors.mjs";
import { digest } from "./json.mjs";
import { validateSession } from "./session.mjs";
import { authIdentity, createFailure, interaction, sharkClient } from "./shark.mjs";
import { FINAL_STATES } from "./store.mjs";

const RETRY = [5000, 30_000, 120_000, 600_000, 3_600_000];
const resolvedReply = new Set(["replied", "approved", "denied", "yes", "no"]);
const shortResult = (row, code) => ({
  id: row.id,
  state: row.state,
  ...(row.data.serverID
    ? { [row.kind === "notification" ? "notificationId" : "interactionId"]: row.data.serverID }
    : {}),
  code:
    code ??
    (row.state === "undeliverable" ||
    (row.state === "canceling" && row.data.cancelReason === "undeliverable")
      ? 7
      : FINAL_STATES.has(row.state)
        ? 0
        : row.state === "pending" && !row.lastError
          ? 0
          : row.state === "auth_blocked"
            ? 3
            : ["failed", "conflict", "rejected"].includes(row.state)
              ? 1
              : 6),
});

export class Broker {
  constructor({
    store,
    config,
    api = sharkClient(config),
    adapter = new AdapterRouter(),
    now = Date.now,
    random = Math.random,
    checkpoint = async () => {},
  }) {
    Object.assign(this, { store, config, api, adapter, now, random, checkpoint });
    this.owner = randomUUID();
  }
  adapterFor(session) {
    return this.adapter.forSession ? this.adapter.forSession(session) : this.adapter;
  }
  async identity() {
    try {
      return authIdentity(await this.api.auth());
    } catch (error) {
      if (error instanceof BrokerError) throw error;
      throw new BrokerError([401, 403].includes(error?.status) ? 3 : 6, "broker_auth_unavailable");
    }
  }
  verifyIdentity(row, identity) {
    if (row.tokenID !== identity || row.data.apiUrl !== this.config.apiUrl)
      throw new BrokerError(3, "creating_identity_changed");
  }
  async targets() {
    let body;
    try {
      body = await this.api.devices();
    } catch (error) {
      throw new BrokerError(
        [401, 403].includes(error?.status) ? 3 : 6,
        "device_discovery_unavailable",
      );
    }
    const ids = selectDevices(body?.devices);
    if (!ids.length) throw new BrokerError(7, "no_reply_capable_device");
    return ids;
  }
  async register(input) {
    const formatted = completion(input);
    const ref = input.session === undefined ? undefined : validateSession(input.session);
    if (formatted.kind === "deferred") requireValue(ref, "session_reference_required");
    const seconds = formatted.kind === "deferred" ? expiry(input.expiresInSeconds) : null;
    const intent = {
      version: 1,
      kind: formatted.kind,
      content: formatted.content,
      session: ref ?? null,
      expiresInSeconds: seconds,
      question: formatted.question ?? null,
    };
    return this.prepare({
      key: formatted.key,
      kind: formatted.kind,
      intent,
      ref,
      makePayload: async () => ({
        ...formatted.content,
        ...(seconds === null ? {} : { expiresInSeconds: seconds, deviceIds: await this.targets() }),
      }),
    });
  }
  async registerActive({
    session,
    kind,
    requestID,
    prompt,
    title = "Agent needs input",
    idempotencyKey,
    expiresInSeconds = 1800,
  }) {
    const ref = validateSession(session);
    requireValue(["form", "permission"].includes(kind), "request_kind");
    requireValue(
      typeof requestID === "string" && requestID.length > 0 && requestID.length <= 512,
      "request_id",
    );
    const content = { title: text(title, "title", 80), prompt: text(prompt, "prompt", 2000) };
    const key = text(idempotencyKey, "idempotency_key", 200);
    const seconds = expiry(expiresInSeconds);
    const nativeRequest = { kind, id: requestID };
    const intent = {
      version: 1,
      kind: "active",
      session: ref,
      request: nativeRequest,
      content,
      expiresInSeconds: seconds,
    };
    return this.prepare({
      key,
      kind: "active",
      intent,
      ref,
      makePayload: async (bound) => {
        const receipt = await this.adapterFor(bound).receipt(bound, nativeRequest);
        if (
          !receipt ||
          receipt.request?.sessionID !== bound.sessionId ||
          receipt.request.id !== requestID ||
          receipt.state?.status !== "pending" ||
          receipt.available !== true
        )
          throw new BrokerError(6, "native_request_unavailable");
        let mapping;
        if (kind === "permission") mapping = { type: "approval" };
        else {
          const fields = receipt.request.fields;
          requireValue(Array.isArray(fields) && fields.length === 1, "unsupported_form_shape");
          const field = fields[0];
          requireValue(
            typeof field.key === "string" &&
              field.key.length > 0 &&
              field.key.length <= 512 &&
              ["string", "boolean"].includes(field.type) &&
              !field.when &&
              !field.options &&
              !field.format &&
              !field.pattern &&
              !field.minLength &&
              (!field.maxLength || field.maxLength >= 4000),
            "unsupported_form_shape",
          );
          mapping = { type: field.type === "string" ? "reply" : "yes_no", field: field.key };
        }
        return {
          payload: {
            ...content,
            kind: mapping.type,
            expiresInSeconds: seconds,
            deviceIds: await this.targets(),
          },
          active: { ...nativeRequest, digest: digest(receipt.request), mapping },
        };
      },
    });
  }
  async prepare({ key, kind, intent, ref, makePayload }) {
    const identity = await this.identity();
    const existing = this.store.byKey(key);
    const intentHash = digest(intent);
    if (existing) {
      this.verifyIdentity(existing, identity);
      if (existing.kind !== kind || existing.data.intentHash !== intentHash)
        throw new BrokerError(1, "idempotency_conflict");
      if (existing.state === "rejected" && existing.data.replaceDevices === true) {
        const lease = this.store.claim(existing.id, this.owner);
        if (!lease) return shortResult(existing, 6);
        try {
          this.store.update(existing.id, this.owner, {
            state: "creating",
            lastError: null,
            nextAttemptAt: this.now(),
            data: {
              payload: { ...existing.data.payload, deviceIds: await this.targets() },
              replaceDevices: false,
            },
          });
        } finally {
          this.store.release(existing.id, this.owner);
        }
      }
      return this.process(existing.id, identity);
    }
    let session;
    if (ref) {
      const probe = await this.adapterFor(ref).probe(ref);
      if (probe.status !== "available")
        throw new BrokerError(probe.status === "missing" ? 4 : 6, "session_unavailable");
      session = probe.session;
    }
    const result = await makePayload(session);
    const data = {
      apiUrl: this.config.apiUrl,
      intent,
      intentHash,
      payload: kind === "active" ? result.payload : result,
      ...(session ? { session } : {}),
      ...(kind === "active" ? { active: result.active } : {}),
      attempts: 0,
      networkFailures: 0,
      nextProbeAt: this.now() + 900_000,
    };
    const row = this.store.insert({ key, tokenID: identity, kind, data });
    await this.checkpoint("prepared", row);
    return this.process(row.id, identity);
  }
  async process(id, knownIdentity, force = false) {
    const lease = this.store.claim(id, this.owner);
    if (!lease) {
      const row = this.store.get(id);
      if (!row) throw new BrokerError(4, "queue_item_missing");
      return shortResult(row, 6);
    }
    try {
      let row = lease;
      if (
        FINAL_STATES.has(row.state) ||
        ["failed", "conflict", "rejected", "unknown"].includes(row.state)
      )
        return shortResult(row);
      if (!force && this.now() < row.nextAttemptAt) return shortResult(row);
      let identity;
      try {
        identity = knownIdentity ?? (await this.identity());
        this.verifyIdentity(row, identity);
      } catch (error) {
        if (error.code === 3) this.block(row, "creating_identity_unavailable");
        else this.defer(row, "broker_auth_unavailable");
        return shortResult(this.store.get(id), error.code ?? 6);
      }
      if (row.state === "auth_blocked")
        row = this.store.update(id, this.owner, {
          state: row.data.resumeState ?? "creating",
          lastError: null,
        });
      if (row.state === "creating") await this.create(row);
      else if (["pending", "reconciling_zero"].includes(row.state)) await this.poll(row);
      else if (row.state === "canceling") await this.cancel(row);
      row = this.store.get(id);
      if (["ready", "delivering"].includes(row.state)) await this.deliver(row);
      return shortResult(this.store.get(id));
    } finally {
      this.store.release(id, this.owner);
    }
  }
  block(row, reason) {
    return this.store.update(row.id, this.owner, {
      state: "auth_blocked",
      lastError: reason,
      nextAttemptAt: this.now() + 900_000,
      data: { resumeState: row.state === "auth_blocked" ? row.data.resumeState : row.state },
    });
  }
  defer(row, reason) {
    const failures = (row.data.networkFailures ?? 0) + 1;
    return this.store.update(row.id, this.owner, {
      lastError: reason,
      nextAttemptAt: this.now() + Math.min(900_000, 5000 * 2 ** Math.min(failures - 1, 8)),
      data: { networkFailures: failures },
    });
  }
  async create(row) {
    let result;
    try {
      result = await this.api.create(
        row.kind === "notification" ? "notification" : "interaction",
        row.data.payload,
        row.key,
      );
    } catch (error) {
      const failure = createFailure(error);
      if (failure.state === "auth_blocked") return this.block(row, failure.diagnostic);
      if (failure.state === "creating") return this.defer(row, failure.diagnostic);
      return this.store.update(row.id, this.owner, {
        state: failure.state,
        lastError: failure.diagnostic,
        data: { replaceDevices: failure.replaceDevices === true },
      });
    }
    await this.checkpoint("create_response", row);
    if (
      !Number.isSafeInteger(result?.accepted) ||
      result.accepted < 0 ||
      (result.idempotent !== undefined && typeof result.idempotent !== "boolean")
    )
      return this.defer(row, "shark_response_invalid");
    if (row.kind === "notification") {
      if (typeof result.notification?.id !== "string")
        return this.defer(row, "shark_response_invalid");
      return this.store.update(row.id, this.owner, {
        state: result.accepted > 0 ? "delivered" : result.idempotent ? "unknown" : "undeliverable",
        lastError: result.accepted > 0 ? null : "provider_acceptance_zero",
        data: { serverID: result.notification.id, accepted: result.accepted },
      });
    }
    let current;
    try {
      current = interaction({ interaction: { ...result.interaction, accepted: result.accepted } });
    } catch {
      return this.defer(row, "shark_response_invalid");
    }
    const undeliverable =
      current.status === "pending" && result.accepted === 0 && !result.idempotent;
    row = this.store.update(row.id, this.owner, {
      ...(undeliverable ? { state: "canceling" } : {}),
      data: {
        serverID: current.id,
        serverExpiresAt: Date.parse(current.expiresAt),
        accepted: result.accepted,
        networkFailures: 0,
        ...(undeliverable ? { cancelReason: "undeliverable" } : {}),
      },
    });
    await this.checkpoint("create_attached", row);
    if (current.status !== "pending") return this.observe(row, current);
    if (undeliverable) {
      await this.cancel(row);
      return;
    }
    return this.store.update(row.id, this.owner, {
      state: result.accepted > 0 ? "pending" : "reconciling_zero",
      lastError: null,
      nextAttemptAt: this.nextPoll(row),
    });
  }
  nextPoll(row) {
    return (
      this.now() + (row.kind === "active" ? 2000 : Math.round(45_000 * (0.9 + this.random() * 0.2)))
    );
  }
  async poll(row) {
    if (row.kind === "active") {
      const state = await this.adapterFor(row.data.session).activeState(
        row.data.session,
        row.data.active,
        row.data.nativeInput,
      );
      if (state.status === "missing") {
        row = this.store.update(row.id, this.owner, {
          state: "canceling",
          data: { targetMissing: true },
        });
        return this.cancel(row);
      }
      if (["accepted", "superseded", "stale"].includes(state.status)) {
        row = this.store.update(row.id, this.owner, {
          state: "canceling",
          data: { resolutionHint: state.status === "accepted" ? "delivered" : state.status },
        });
        return this.cancel(row);
      }
    } else if (this.now() >= row.data.nextProbeAt) {
      const probe = await this.adapterFor(row.data.session).probe(row.data.session);
      row = this.store.update(row.id, this.owner, { data: { nextProbeAt: this.now() + 900_000 } });
      if (probe.status === "missing") {
        row = this.store.update(row.id, this.owner, {
          state: "canceling",
          data: { targetMissing: true },
        });
        return this.cancel(row);
      }
    }
    try {
      const current = interaction(await this.api.get(row.data.serverID), row.data.serverID);
      this.lastPollAt = this.now();
      return this.observe(row, current);
    } catch (error) {
      return [401, 403].includes(error?.status)
        ? this.block(row, "shark_auth_rejected")
        : this.defer(row, "shark_poll_unavailable");
    }
  }
  async observe(row, current) {
    if (current.kind !== row.data.payload.kind) return this.defer(row, "shark_response_invalid");
    const reply = {
      status: current.status,
      ...(current.status === "replied" ? { response: current.response } : {}),
    };
    row = this.store.update(row.id, this.owner, {
      data: { serverStatus: current.status, accepted: current.accepted, networkFailures: 0 },
    });
    if (current.status === "pending")
      return this.store.update(row.id, this.owner, {
        state: current.accepted > 0 ? "pending" : "reconciling_zero",
        lastError: null,
        nextAttemptAt: this.nextPoll(row),
      });
    if (row.data.resolutionHint || row.data.cancelReason === "discarded")
      return this.store.update(row.id, this.owner, {
        state: row.data.resolutionHint ?? "discarded",
        lastError: null,
        data: {
          reply,
          conflictingReply:
            resolvedReply.has(current.status) && row.data.resolutionHint !== "delivered",
        },
      });
    if (["canceled", "expired"].includes(current.status))
      return this.store.update(row.id, this.owner, {
        state: row.data.cancelReason === "undeliverable" ? "undeliverable" : current.status,
        lastError: null,
      });
    const suffix = createHash("sha256")
      .update(`${row.data.apiUrl}\0${row.tokenID}\0${row.data.serverID}`)
      .digest("hex")
      .slice(0, 40);
    let deliveryID;
    let nativeInput;
    if (row.kind === "deferred" && current.status === "replied") {
      deliveryID = `msg_shark_${suffix}`;
      nativeInput = {
        id: deliveryID,
        text: `SHark deferred reply\nDelivery ID: ${deliveryID}\n\nQuestion: ${row.data.intent.question}\n\nReply: ${current.response}`,
        delivery: "queue",
      };
    } else if (row.kind === "active") {
      deliveryID = `shark_${suffix}`;
      const mapping = row.data.active.mapping;
      let payload;
      if (mapping.type === "approval" && ["approved", "denied"].includes(current.status))
        payload = { reply: current.status === "approved" ? "once" : "reject" };
      else if (mapping.type === "reply" && current.status === "replied")
        payload = { answer: { [mapping.field]: current.response } };
      else if (mapping.type === "yes_no" && ["yes", "no"].includes(current.status))
        payload = { answer: { [mapping.field]: current.status === "yes" } };
      if (payload) nativeInput = { responseID: deliveryID, payload };
    }
    if (!nativeInput) return this.fail(row, "unexpected_reply_kind", reply);
    row = this.store.update(row.id, this.owner, {
      state: "ready",
      lastError: null,
      nextAttemptAt: this.now(),
      data: { reply, deliveryID, nativeInput },
    });
    await this.checkpoint("reply_prepared", row);
    if (row.data.targetMissing) return this.fail(row, "session_missing");
    return row;
  }
  async cancel(row) {
    if (!row.data.serverID) return this.defer(row, "server_identity_unknown");
    let result;
    try {
      result = await this.api.cancel(row.data.serverID);
    } catch (error) {
      if ([401, 403].includes(error?.status)) return this.block(row, "shark_auth_rejected");
      if (error?.status === 409) result = error.body;
      else {
        try {
          result = await this.api.get(row.data.serverID);
        } catch {
          return this.defer(row, "shark_cancel_unknown");
        }
      }
    }
    let current;
    try {
      current = interaction(result, row.data.serverID);
    } catch {
      return this.defer(row, "shark_cancel_unknown");
    }
    if (current.status === "pending") return this.defer(row, "shark_cancel_unknown");
    await this.checkpoint("cancel_response", row);
    return this.observe(row, current);
  }
  async deliver(row) {
    row = this.store.update(row.id, this.owner, { state: "delivering" });
    await this.checkpoint("before_admission", row);
    const adapter = this.adapterFor(row.data.session);
    const result =
      row.kind === "active"
        ? await adapter.answer(row.data.session, row.data.active, row.data.nativeInput)
        : adapter.retrySafe === false && row.data.nativeAttempted
          ? await adapter.reconcile(row.data.session, row.data.nativeInput)
          : await adapter.deliver(row.data.session, row.data.nativeInput, {
              beforeSend: async () => {
                row = this.store.update(row.id, this.owner, { data: { nativeAttempted: true } });
                await this.checkpoint("codex_before_submit", row);
              },
            });
    await this.checkpoint("after_admission", row);
    if (result.status === "accepted")
      return this.store.update(row.id, this.owner, {
        state: "delivered",
        lastError: null,
        data: {
          admission: "accepted",
          ...(result.receipt ? { nativeReceipt: result.receipt } : {}),
        },
      });
    if (["superseded", "stale"].includes(result.status))
      return this.store.update(row.id, this.owner, {
        state: result.status,
        lastError: null,
        data: { conflictingReply: true },
      });
    if (["missing", "conflict"].includes(result.status))
      return this.fail(
        row,
        result.status === "missing" ? "session_missing" : "native_input_conflict",
      );
    if (adapter.retrySafe === false && row.data.nativeAttempted)
      return this.fail(row, "codex_admission_unknown", undefined, "unknown");
    const attempts = (row.data.attempts ?? 0) + 1;
    if (attempts > RETRY.length) return this.fail(row, "native_admission_unconfirmed");
    return this.store.update(row.id, this.owner, {
      state: "ready",
      lastError: "native_admission_unconfirmed",
      nextAttemptAt: this.now() + RETRY[attempts - 1],
      data: { attempts },
    });
  }
  fail(row, reason, reply, state = "failed") {
    return this.store.transaction(() => {
      const failed = this.store.update(row.id, this.owner, {
        state,
        lastError: reason,
        data: {
          ...(reply ? { reply } : {}),
          ...(row.data.nativeAttempted ? { recoveryNoticeCreated: true } : {}),
        },
      });
      if (!row.data.failureFor && !(row.data.nativeAttempted && row.data.recoveryNoticeCreated)) {
        const payload = {
          title: "SHark reply needs recovery",
          body: "A reply could not be admitted by its agent. Review the host's sharkd recovery queue.",
          ...(row.data.payload.deviceIds ? { deviceIds: row.data.payload.deviceIds } : {}),
        };
        const intent = { version: 1, kind: "failure", source: row.id, payload };
        this.store.insert({
          key: `sharkd:failure:${row.id}`,
          tokenID: row.tokenID,
          kind: "notification",
          data: {
            apiUrl: row.data.apiUrl,
            intent,
            intentHash: digest(intent),
            payload,
            failureFor: row.id,
          },
        });
      }
      return failed;
    });
  }
  async tick() {
    const results = [];
    for (const id of this.store.due()) results.push(await this.process(id));
    this.store.prune();
    return results;
  }
  async retry(id) {
    const row = this.store.claim(id, this.owner);
    if (!row) throw new BrokerError(6, "queue_item_busy_or_missing");
    try {
      if (FINAL_STATES.has(row.state)) throw new BrokerError(4, "queue_item_terminal");
      if (["conflict", "rejected"].includes(row.state))
        throw new BrokerError(1, "retry_original_registration_required");
      const state = row.data.nativeAttempted
        ? "ready"
        : row.state === "failed"
          ? row.data.nativeInput
            ? "ready"
            : "creating"
          : row.state === "unknown"
            ? "creating"
            : row.state;
      this.store.update(id, this.owner, {
        state,
        nextAttemptAt: this.now(),
        data: { attempts: 0, networkFailures: 0 },
      });
    } finally {
      this.store.release(id, this.owner);
    }
    return this.process(id);
  }
  async discard(id) {
    let row = this.store.get(id);
    if (!row) throw new BrokerError(4, "queue_item_missing");
    const identity = await this.identity();
    this.verifyIdentity(row, identity);
    if (
      row.kind !== "notification" &&
      !row.data.serverID &&
      !["rejected", "conflict"].includes(row.state)
    ) {
      await this.process(id, identity, true);
      row = this.store.get(id);
      if (!row.data.serverID) throw new BrokerError(6, "discard_requires_server_reconciliation");
    }
    row = this.store.claim(id, this.owner);
    if (!row) throw new BrokerError(6, "queue_item_busy");
    try {
      if (
        row.kind === "notification" ||
        FINAL_STATES.has(row.state) ||
        ["rejected", "conflict"].includes(row.state) ||
        resolvedReply.has(row.data.serverStatus)
      ) {
        return shortResult(
          this.store.update(id, this.owner, { state: "discarded", lastError: null }),
        );
      }
      row = this.store.update(id, this.owner, {
        state: "canceling",
        data: { cancelReason: "discarded" },
      });
      await this.cancel(row);
      const current = this.store.get(id);
      return shortResult(current, FINAL_STATES.has(current.state) ? 0 : 6);
    } finally {
      this.store.release(id, this.owner);
    }
  }
}
