import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { protectedJSON } from "../src/files.mjs";
import { RETAIN_MS, Store } from "../src/store.mjs";

const registration = (key = "synthetic-key") => ({
  key,
  tokenID: "synthetic-creator",
  kind: "deferred",
  data: {
    apiUrl: "https://example.invalid",
    intentHash: "synthetic-hash",
    intent: { title: "Synthetic" },
    payload: { prompt: "Synthetic", deviceIds: ["phone_1"] },
  },
});

async function fixture(t, options) {
  const root = await mkdtemp(path.join(tmpdir(), "sharkd-store-"));
  const file = path.join(root, "broker.sqlite");
  const store = await Store.open(file, options);
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { store, file, root };
}

test("prepared payload and host identity survive reopening with WAL and full synchronization", async (t) => {
  const { store, file, root } = await fixture(t);
  const row = store.insert(registration());
  const host = store.hostID();
  const reopened = await Store.open(file);
  try {
    assert.deepEqual(reopened.get(row.id).data, row.data);
    assert.equal(reopened.hostID(), host);
    assert.equal(reopened.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    assert.equal(reopened.db.prepare("PRAGMA synchronous").get().synchronous, 2);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    for (const suffix of ["", "-wal", "-shm"])
      assert.equal((await stat(file + suffix)).mode & 0o777, 0o600);
  } finally {
    reopened.close();
  }
});

test("a transaction cannot leave half a reply/notice transition", async (t) => {
  const { store } = await fixture(t);
  const row = store.insert(registration());
  store.claim(row.id, "worker");
  assert.throws(() =>
    store.transaction(() => {
      store.update(row.id, "worker", { state: "failed", data: { reply: "synthetic reply" } });
      store.insert(registration("failure-notice"));
      throw new Error("simulated transaction failure");
    }),
  );
  assert.equal(store.get(row.id).state, "creating");
  assert.equal(store.byKey("failure-notice"), undefined);
  assert.equal(store.get(row.id).data.reply, undefined);
});

test("two connections preserve the first key binding and fence an expired worker", async (t) => {
  let now = 1000;
  const { store, file } = await fixture(t, { now: () => now });
  const other = await Store.open(file, { now: () => now });
  try {
    const row = store.insert(registration());
    assert.equal(other.insert(registration()).id, row.id);
    assert.throws(
      () =>
        other.insert({
          ...registration(),
          data: { ...registration().data, intentHash: "different" },
        }),
      /idempotency_conflict/,
    );
    assert.ok(store.claim(row.id, "old", 100));
    assert.equal(other.claim(row.id, "new"), undefined);
    now += 101;
    assert.ok(other.claim(row.id, "new"));
    assert.throws(() => store.update(row.id, "old", { state: "delivered" }), /lease_lost/);
    other.update(row.id, "new", {
      state: "ready",
      data: { deliveryID: "msg_stable", nativeInput: { text: "first" } },
    });
    assert.throws(
      () => other.update(row.id, "new", { data: { deliveryID: "msg_replacement" } }),
      /immutable_intent_changed/,
    );
    assert.throws(
      () => other.update(row.id, "new", { data: { payload: { prompt: "changed" } } }),
      /persisted_payload_changed/,
    );
  } finally {
    other.close();
  }
});

test("device replacement can change only selection after the definitive pre-insertion rejection", async (t) => {
  const { store } = await fixture(t);
  const row = store.insert(registration());
  store.claim(row.id, "worker");
  store.update(row.id, "worker", { state: "rejected", data: { replaceDevices: true } });
  assert.throws(
    () =>
      store.update(row.id, "worker", {
        state: "creating",
        data: { payload: { prompt: "changed", deviceIds: ["phone_2"] } },
      }),
    /persisted_payload_changed/,
  );
  assert.deepEqual(
    store.update(row.id, "worker", {
      state: "creating",
      data: { payload: { prompt: "Synthetic", deviceIds: ["phone_2"] }, replaceDevices: false },
    }).data.payload.deviceIds,
    ["phone_2"],
  );
});

test("terminal payloads purge after seven days but old keys cannot re-admit a reply", async (t) => {
  let now = 1000;
  const { store } = await fixture(t, { now: () => now });
  const terminal = store.insert(registration());
  store.claim(terminal.id, "worker");
  store.update(terminal.id, "worker", { state: "delivered" });
  store.release(terminal.id, "worker");
  const failed = store.insert(registration("failed"));
  store.claim(failed.id, "worker");
  store.update(failed.id, "worker", { state: "failed", data: { reply: "kept for recovery" } });
  store.release(failed.id, "worker");
  now += RETAIN_MS + 1;
  assert.equal(store.prune(), 1);
  assert.equal(store.get(terminal.id), undefined);
  assert.equal(store.get(failed.id).data.reply, "kept for recovery");
  assert.throws(() => store.insert(registration()), /retired_idempotency_key/);
  assert.ok(!JSON.stringify(store.list()).includes("kept for recovery"));
});

test("daemon ownership survives idle periods and rejects a competing live owner", async (t) => {
  let now = 1000;
  const { store } = await fixture(t, { now: () => now });
  const first = {
    instanceID: "first",
    pid: 10,
    execPath: "/synthetic/node",
    entryPath: "/synthetic/sharkd",
  };
  store.acquireDaemon(first, () => false);
  assert.throws(
    () => store.acquireDaemon({ ...first, instanceID: "second" }, () => true),
    /daemon_already_running/,
  );
  now += 30_000;
  store.heartbeat("first");
  assert.equal(store.daemonState().heartbeatAt, now);
  store.acquireDaemon({ ...first, instanceID: "second" }, () => false);
  assert.throws(() => store.heartbeat("first"), /daemon_ownership_lost/);
});

test("protected files reject permissive modes and symlinks", async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, "config.json");
  await writeFile(file, '{"synthetic":true}', { mode: 0o600 });
  assert.deepEqual(await protectedJSON(file), { synthetic: true });
  await chmod(file, 0o644);
  await assert.rejects(protectedJSON(file), /protected_file_unavailable/);
  await chmod(file, 0o600);
  const link = path.join(root, "link");
  await symlink(file, link);
  await assert.rejects(protectedJSON(link), /protected_file_unavailable/);
});
