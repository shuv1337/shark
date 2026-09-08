import assert from "node:assert/strict";
import { test } from "node:test";
import { admitDeferredReply } from "./deferred.mjs";

const sessionID = "ses_synthetic";
const input = { id: "msg_synthetic_reply", text: "Untrusted reply stays structured" };
const receipt = {
  id: input.id,
  sessionID,
  type: "user",
  delivery: "queue",
  payload: { text: input.text },
};
for (const [name, response, status] of [
  ["matching queue receipt", { status: 200, body: { data: receipt } }, "accepted"],
  [
    "first-admission-wins changed text",
    { status: 200, body: { data: { ...receipt, payload: { text: "old" } } } },
    "conflict",
  ],
  [
    "different session",
    { status: 200, body: { data: { ...receipt, sessionID: "ses_other" } } },
    "unknown",
  ],
  [
    "different input kind",
    { status: 200, body: { data: { ...receipt, type: "synthetic" } } },
    "unknown",
  ],
  ["malformed acknowledgement", { status: 200, body: {} }, "unknown"],
  ["missing session", { status: 404 }, "missing"],
  ["native ID conflict", { status: 409 }, "conflict"],
  ["server unavailable", { status: 503 }, "unknown"],
]) {
  test(name, async () => {
    let calls = 0;
    const native = async (method, route, payload) => {
      calls++;
      assert.equal(method, "POST");
      assert.equal(route, `/api/session/${sessionID}/prompt`);
      assert.deepEqual(payload, { ...input, delivery: "queue" });
      return response;
    };
    assert.deepEqual(await admitDeferredReply({ native, sessionID, input }), { status });
    assert.equal(calls, 1);
  });
}

test("a lost response does not allocate a replacement ID or retry by itself", async () => {
  let calls = 0;
  const native = async () => {
    calls++;
    throw new Error("lost response");
  };
  assert.deepEqual(await admitDeferredReply({ native, sessionID, input }), { status: "unknown" });
  assert.equal(calls, 1);
});
