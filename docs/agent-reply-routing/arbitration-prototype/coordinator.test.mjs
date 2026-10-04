import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileActiveReply, requestDigest, settleSharkInteraction } from "./coordinator.mjs";

const request = {
  id: "frm_fixture",
  sessionID: "ses_fixture",
  fields: [{ key: "reply", type: "string" }],
};
const target = {
  kind: "form",
  requestID: request.id,
  sessionID: request.sessionID,
  digest: requestDigest(request),
};
const intent = {
  responseID: "synthetic-stable-id",
  payload: { answer: { reply: "$(do-not-execute)" } },
};

test("a lost acknowledgement reconciles the exact response and preserves structured text", async () => {
  let receipt = { request, state: { status: "pending" }, available: true };
  let posts = 0;
  const native = async (method, _route, body) => {
    if (method === "POST") {
      posts++;
      assert.deepEqual(body.answer, intent.payload.answer);
      receipt = {
        request,
        state: { status: "answered", answer: body.answer },
        responseID: body.responseID,
        available: false,
      };
      throw new Error("synthetic response loss");
    }
    return { status: 200, body: { data: receipt } };
  };
  assert.deepEqual(await reconcileActiveReply({ native, target, intent }), { status: "accepted" });
  assert.deepEqual(await reconcileActiveReply({ native, target, intent }), { status: "accepted" });
  assert.equal(posts, 1);
});

for (const [name, receipt, expected] of [
  ["missing receipt", undefined, "unknown"],
  ["wrong session", { request: { ...request, sessionID: "ses_other" } }, "unknown"],
  ["changed request", { request: { ...request, fields: [] } }, "stale"],
  ["unavailable callback", { request, state: { status: "pending" }, available: false }, "unknown"],
  ["cancelled request", { request, state: { status: "cancelled" } }, "stale"],
  [
    "another ID with identical answer",
    {
      request,
      state: { status: "answered", answer: intent.payload.answer },
      responseID: "desktop",
    },
    "superseded",
  ],
  [
    "same ID with changed answer",
    {
      request,
      state: { status: "answered", answer: { reply: "other" } },
      responseID: intent.responseID,
    },
    "superseded",
  ],
]) {
  test(`${name} cannot admit input`, async () => {
    const native = async (method) => {
      assert.equal(method, "GET");
      return { status: 200, body: { data: receipt } };
    };
    assert.equal((await reconcileActiveReply({ native, target, intent })).status, expected);
  });
}

test("an unresolved POST failure is unknown with no automatic second attempt", async () => {
  let posts = 0;
  const native = async (method) => {
    if (method === "POST") {
      posts++;
      throw new Error("unreachable");
    }
    return {
      status: 200,
      body: { data: { request, state: { status: "pending" }, available: true } },
    };
  };
  assert.equal((await reconcileActiveReply({ native, target, intent })).status, "unknown");
  assert.equal(posts, 1);
});

test("SHark cancellation races preserve a stored losing reply without reporting acceptance", async () => {
  let status = "pending";
  const result = await settleSharkInteraction({
    outcome: { status: "superseded" },
    get: async () => ({ interaction: { status } }),
    cancel: async () => {
      status = "replied";
      throw new Error("409 replied");
    },
  });
  assert.deepEqual(result, {
    status: "superseded",
    sharkStatus: "replied",
    cleanupPending: false,
    conflictingReply: true,
  });
});

test("unknown native admission keeps the SHark interaction pending", async () => {
  const result = await settleSharkInteraction({
    outcome: { status: "unknown" },
    get: async () => ({ interaction: { status: "pending" } }),
    cancel: async () => assert.fail("must not cancel on unknown"),
  });
  assert.equal(result.sharkStatus, "pending");
});

test("request digest is independent of object property order", () => {
  assert.equal(
    requestDigest({ b: 2, a: { d: 4, c: 3 } }),
    requestDigest({ a: { c: 3, d: 4 }, b: 2 }),
  );
});
