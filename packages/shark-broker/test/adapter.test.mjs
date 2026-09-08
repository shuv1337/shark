import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { OpenCodeAdapter } from "../src/adapters/opencode-v2.mjs";
import { digest } from "../src/json.mjs";
import { fixture, session } from "./fixture.mjs";

async function native(t) {
  const f = await fixture(t);
  const authFile = path.join(f.root, "native-auth.json");
  await writeFile(authFile, JSON.stringify({ password: "synthetic-native-password" }), {
    mode: 0o600,
  });
  const ref = { ...session, generation: 1, adapterData: { ...session.adapterData, authFile } };
  const request = {
    id: "frm_synthetic",
    sessionID: ref.sessionId,
    fields: [{ key: "answer", type: "string" }],
  };
  const state = {
    generation: 1,
    directory: ref.cwd,
    status: 200,
    receipt: { request, state: { status: "pending" }, available: true },
    posts: 0,
    promptReceipt: null,
  };
  const adapter = new OpenCodeAdapter({
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["x-opencode-directory"], encodeURIComponent(ref.cwd));
      let data;
      if (url.endsWith("/receipt")) data = state.receipt;
      else if (options.method === "GET")
        data = {
          id: ref.sessionId,
          time: { created: state.generation },
          location: { directory: state.directory },
        };
      else {
        state.posts++;
        const body = JSON.parse(options.body);
        if (url.endsWith("/prompt"))
          data = state.promptReceipt ?? {
            ...body,
            sessionID: ref.sessionId,
            type: "user",
            payload: { text: body.text },
          };
        else {
          state.receipt = {
            ...state.receipt,
            responseID: body.responseID,
            state: { status: "answered", answer: body.answer },
          };
          throw new Error("Synthetic lost response after commit");
        }
      }
      return new Response(JSON.stringify({ data }), { status: state.status });
    },
  });
  return {
    ref,
    state,
    adapter,
    target: { id: request.id, kind: "form", digest: digest(request) },
    intent: { responseID: "synthetic-response", payload: { answer: { answer: "$(inert)" } } },
  };
}

test("native exact active retry reads durable receipt after lost acknowledgement without another POST", async (t) => {
  const f = await native(t);
  assert.deepEqual(await f.adapter.answer(f.ref, f.target, f.intent), { status: "accepted" });
  assert.deepEqual(await f.adapter.answer(f.ref, f.target, f.intent), { status: "accepted" });
  assert.equal(f.state.posts, 1);
  const changed = { ...f.intent, payload: { answer: { answer: "changed" } } };
  assert.deepEqual(await f.adapter.answer(f.ref, f.target, changed), { status: "superseded" });
  assert.equal(f.state.posts, 1);
});

test("moved, recycled, deleted and unavailable sessions never receive native input", async (t) => {
  const f = await native(t);
  const input = { id: "msg_synthetic", text: "Synthetic", delivery: "queue" };
  f.state.directory = "/moved";
  assert.equal((await f.adapter.deliver(f.ref, input)).status, "unknown");
  assert.equal((await f.adapter.answer(f.ref, f.target, f.intent)).status, "unknown");
  f.state.directory = f.ref.cwd;
  f.state.generation = 2;
  assert.equal((await f.adapter.deliver(f.ref, input)).status, "missing");
  f.state.status = 404;
  assert.equal((await f.adapter.answer(f.ref, f.target, f.intent)).status, "missing");
  f.state.status = 503;
  assert.equal((await f.adapter.deliver(f.ref, input)).status, "unknown");
  assert.equal(f.state.posts, 0);
});

test("missing receipts and unavailable callbacks stay unknown, changed requests are stale", async (t) => {
  const f = await native(t);
  f.state.receipt.available = false;
  assert.equal((await f.adapter.answer(f.ref, f.target, f.intent)).status, "unknown");
  f.state.receipt.request.fields[0].key = "changed";
  assert.equal((await f.adapter.answer(f.ref, f.target, f.intent)).status, "stale");
  f.state.receipt = null;
  assert.equal((await f.adapter.answer(f.ref, f.target, f.intent)).status, "unknown");
  assert.equal(f.state.posts, 0);
});

test("deferred admission checks the returned full queued input, including a conflicting native 200", async (t) => {
  const f = await native(t);
  const input = { id: "msg_synthetic", text: "Synthetic", delivery: "queue" };
  assert.equal((await f.adapter.deliver(f.ref, input)).status, "accepted");
  f.state.promptReceipt = {
    ...input,
    sessionID: f.ref.sessionId,
    type: "user",
    payload: { text: "Earlier different text" },
  };
  assert.equal((await f.adapter.deliver(f.ref, input)).status, "conflict");
});
