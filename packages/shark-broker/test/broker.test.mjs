import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createFailure } from "../src/shark.mjs";
import { completion, fixture, requestError } from "./fixture.mjs";

test("completion returns pending, explicitly targets reply-capable devices, and routes the stored reply once", async (t) => {
  const f = await fixture(t);
  const broker = f.broker();
  const result = await broker.register(completion());
  assert.equal(result.code, 0);
  assert.equal(result.state, "pending");
  const row = f.store.get(result.id);
  assert.deepEqual(row.data.payload.deviceIds, ["phone"]);
  assert.equal(row.data.payload.expiresInSeconds, 28_800);
  assert.equal(row.data.session.generation, 1);
  f.answer(result.id, "$(inert); `inert` payload");
  f.advance(45_000);
  await broker.tick();
  const delivered = f.store.get(result.id);
  assert.equal(delivered.state, "delivered");
  assert.equal(f.native.size, 1);
  assert.ok(delivered.data.nativeInput.text.includes("$(inert); `inert` payload"));
  assert.ok(delivered.data.nativeInput.text.includes("What next?"));
  assert.equal((await broker.register(completion())).id, result.id);
  assert.equal(f.native.size, 1);
  assert.equal(f.state.createCalls, 1);
});

for (const boundary of [
  "prepared",
  "create_response",
  "create_attached",
  "reply_prepared",
  "before_admission",
  "after_admission",
]) {
  test(`recovery at ${boundary} preserves one remote interaction and one native input`, async (t) => {
    const f = await fixture(t);
    const crashing = f.broker({
      checkpoint: async (name) => {
        if (name === boundary) throw new Error("synthetic process boundary");
      },
    });
    let first;
    try {
      first = await crashing.register(completion());
    } catch {
      /* restart below */
    }
    const row = f.store.byKey("synthetic-turn");
    if (first) {
      f.answer(row.id);
      f.advance(45_000);
      await assert.rejects(crashing.tick(), /synthetic process boundary/);
    }
    const reopened = await f.open();
    const recovered = f.broker({ store: reopened });
    await recovered.process(row.id);
    if (reopened.get(row.id).state === "pending") {
      f.answer(row.id);
      f.advance(45_000);
      await recovered.tick();
    }
    assert.equal(reopened.get(row.id).state, "delivered");
    assert.equal(f.remote.size, 1);
    assert.equal(f.native.size, 1);
  });
}

test("initial accepted-zero cancellation survives a crash after attaching the server ID", async (t) => {
  const f = await fixture(t);
  f.state.accepted = 0;
  const first = f.broker({
    checkpoint: async (name) => {
      if (name === "create_attached") throw new Error("crash");
    },
  });
  await assert.rejects(first.register(completion()));
  const row = f.store.byKey("synthetic-turn");
  assert.equal(row.state, "canceling");
  const result = await f.broker().process(row.id);
  assert.equal(result.code, 7);
  assert.equal(result.state, "undeliverable");
  assert.equal(f.state.cancelCalls, 1);
});

test("a lost initial zero response uses reconciling_zero and never cancels an in-flight successful send", async (t) => {
  const f = await fixture(t);
  f.state.accepted = 0;
  const first = f.broker({
    checkpoint: async (name) => {
      if (name === "create_response") throw new Error("crash");
    },
  });
  await assert.rejects(first.register(completion()));
  const broker = f.broker();
  const row = f.store.byKey("synthetic-turn");
  assert.equal((await broker.process(row.id)).state, "reconciling_zero");
  assert.equal(f.state.cancelCalls, 0);
  f.remote.get(f.store.get(row.id).data.serverID).accepted = 1;
  f.advance(45_000);
  await broker.tick();
  assert.equal(f.store.get(row.id).state, "pending");
});

test("ambiguous zero cancellation stays tracked and initial creation exits 7", async (t) => {
  const f = await fixture(t);
  f.state.accepted = 0;
  f.state.cancelError = requestError(503, "unknown");
  f.state.getError = requestError(503, "unknown");
  const result = await f.broker().register(completion());
  assert.equal(result.code, 7);
  assert.equal(result.state, "canceling");
  assert.ok(f.store.get(result.id).data.serverID);
});

test("auth preflight, missing targets, and unknown session probes create no interaction", async (t) => {
  const f = await fixture(t);
  f.state.scopes = [];
  await assert.rejects(f.broker().register(completion()), (error) => error.code === 3);
  f.state.scopes = [
    "notifications:send",
    "interactions:create",
    "interactions:read",
    "devices:read",
  ];
  f.state.probe = "unknown";
  await assert.rejects(f.broker().register(completion()), (error) => error.code === 6);
  f.state.probe = "missing";
  await assert.rejects(f.broker().register(completion()), (error) => error.code === 4);
  f.state.probe = "available";
  f.api.devices = async () => ({
    devices: [{ id: "web", platform: "web", active: true, lastSeenAt: new Date().toISOString() }],
  });
  await assert.rejects(f.broker().register(completion()), (error) => error.code === 7);
  assert.equal(f.remote.size, 0);
  assert.equal(f.store.list().length, 0);
});

test("creating-token change blocks polling, replay and cancellation without replacing its owner", async (t) => {
  const f = await fixture(t);
  const broker = f.broker();
  const result = await broker.register(completion());
  f.state.tokenID = "changed-creator";
  f.advance(45_000);
  await broker.tick();
  assert.equal(f.store.get(result.id).state, "auth_blocked");
  assert.equal(f.store.get(result.id).tokenID, "synthetic-creator");
  await assert.rejects(broker.register(completion()), (error) => error.code === 3);
  await assert.rejects(broker.discard(result.id), (error) => error.code === 3);
  assert.equal(f.state.createCalls, 1);
  assert.equal(f.state.cancelCalls, 0);
  f.state.tokenID = "synthetic-creator";
  await broker.retry(result.id);
  assert.equal(f.store.get(result.id).state, "pending");
});

test("changing between plain completion and a question conflicts locally", async (t) => {
  const f = await fixture(t);
  const broker = f.broker();
  const plain = { summary: "done", idempotencyKey: "same-key" };
  assert.equal((await broker.register(plain)).state, "delivered");
  await assert.rejects(
    broker.register({ ...completion("same-key"), summary: "done" }),
    /idempotency_conflict/,
  );
  assert.equal(f.remote.size, 1);
});

test("only the exact server rejection permits refreshed device selection", async (t) => {
  const f = await fixture(t);
  const broker = f.broker();
  f.state.createError = requestError(400, "Invalid device selection");
  const first = await broker.register(completion());
  assert.equal(first.state, "rejected");
  f.state.createError = undefined;
  f.api.devices = async () => ({
    devices: [
      { id: "phone_new", platform: "ios", active: true, lastSeenAt: new Date().toISOString() },
    ],
  });
  assert.equal((await broker.register(completion())).state, "pending");
  assert.deepEqual(f.store.get(first.id).data.payload.deviceIds, ["phone_new"]);
  const source = await readFile(
    new URL("../../../apps/website/src/server/routes/interactions.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.includes(
      'if (!targets.valid) return c.json({ error: "Invalid device selection" }, 400);',
    ),
  );
  assert.equal(
    createFailure(requestError(400, "Invalid device selection.")).replaceDevices,
    undefined,
  );
  assert.equal(
    createFailure(requestError(422, "Invalid device selection")).replaceDevices,
    undefined,
  );
});

for (const [status, state, code] of [
  [401, "auth_blocked", 3],
  [403, "auth_blocked", 3],
  [409, "conflict", 1],
  [429, "creating", 6],
  [500, "creating", 6],
  [0, "creating", 6],
  [400, "rejected", 1],
  [422, "rejected", 1],
]) {
  test(`create status ${status} maps to durable ${state}`, async (t) => {
    const f = await fixture(t);
    f.state.createError = requestError(status, "synthetic");
    const result = await f.broker().register(completion());
    assert.equal(result.state, state);
    assert.equal(result.code, code);
  });
}

test("delivery backoff retains one ID and emits one non-recursive failure outbox entry", async (t) => {
  const f = await fixture(t);
  const broker = f.broker();
  const row = await broker.register(completion());
  f.answer(row.id);
  f.state.unknownDelivery = true;
  f.advance(45_000);
  const delays = [5000, 30_000, 120_000, 600_000, 3_600_000];
  let deliveryID;
  for (const delay of delays) {
    await broker.tick();
    const item = f.store.get(row.id);
    assert.equal(item.nextAttemptAt - f.now(), delay);
    if (deliveryID) assert.equal(item.data.deliveryID, deliveryID);
    deliveryID = item.data.deliveryID;
    f.advance(delay);
  }
  await broker.tick();
  assert.equal(f.store.get(row.id).state, "failed");
  assert.equal(f.store.list().filter((item) => item.kind === "notification").length, 1);
  f.state.accepted = 0;
  await broker.tick();
  assert.equal(f.store.list().length, 2);
  f.state.unknownDelivery = false;
  assert.equal((await broker.retry(row.id)).state, "delivered");
  assert.equal(f.native.size, 1);
  assert.equal(f.store.get(row.id).data.deliveryID, deliveryID);
});

test("a replied cancel race with a missing target is retained for manual recovery", async (t) => {
  const f = await fixture(t);
  const broker = f.broker();
  const result = await broker.register(completion());
  f.answer(result.id);
  f.state.probe = "missing";
  f.advance(900_000);
  await broker.tick();
  assert.equal(f.store.get(result.id).state, "failed");
  assert.equal(f.store.get(result.id).data.reply.response, "Synthetic answer");
  assert.equal(f.native.size, 0);
});

test("discard refuses ambiguous cancellation and later settles without delivering the stored reply", async (t) => {
  const f = await fixture(t);
  const broker = f.broker();
  const result = await broker.register(completion());
  f.state.cancelError = requestError(503, "unknown");
  assert.equal((await broker.discard(result.id)).code, 6);
  assert.equal(f.store.get(result.id).state, "canceling");
  f.answer(result.id);
  f.state.cancelError = undefined;
  assert.equal((await broker.discard(result.id)).state, "discarded");
  assert.equal(f.native.size, 0);
  assert.equal(f.store.get(result.id).data.reply.response, "Synthetic answer");
});

test("pending poll errors remain visible and a later successful poll updates observability", async (t) => {
  const f = await fixture(t);
  const broker = f.broker();
  const registered = await broker.register(completion());
  f.advance(45_000);
  f.state.getError = requestError(503, "offline");
  assert.equal((await broker.process(registered.id)).code, 6);
  assert.equal(broker.lastPollAt, undefined);
  delete f.state.getError;
  f.advance(5000);
  assert.equal((await broker.process(registered.id)).code, 0);
  assert.equal(broker.lastPollAt, f.now());
});

test("active request unknown state preserves the prompt but definitive session deletion cancels it", async (t) => {
  const f = await fixture(t);
  f.adapter.receipt = async (ref, target) => ({
    request: {
      id: target.id,
      sessionID: ref.sessionId,
      fields: [{ key: "answer", type: "string" }],
    },
    state: { status: "pending" },
    available: true,
  });
  f.adapter.activeState = async () => ({ status: f.state.probe });
  const broker = f.broker();
  const registered = await broker.registerActive({
    session: completion().session,
    kind: "form",
    requestID: "frm_synthetic",
    prompt: "Question",
    idempotencyKey: "active-missing",
  });
  f.state.probe = "unknown";
  assert.equal((await broker.process(registered.id, undefined, true)).state, "pending");
  assert.equal(f.state.cancelCalls, 0);
  f.state.probe = "missing";
  assert.equal((await broker.process(registered.id, undefined, true)).state, "canceled");
  assert.equal(f.state.cancelCalls, 1);
});
