// Opt-in installed-runtime contract test. All state and model traffic are synthetic.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync } from "node:zlib";
import { CodexAdapter } from "../src/adapters/codex.mjs";
import { connectCodex } from "../src/adapters/codex-rpc.mjs";
import { completion, fixture } from "./fixture.mjs";

const binary = process.env.SHARK_CODEX_TEST_BINARY;
const options = { skip: !binary, timeout: 30_000 };
async function until(read, predicate) {
  for (let n = 0; n < 200; n++) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error("Synthetic Codex condition timed out");
}
function finish(response, serial) {
  const item = {
    id: `msg_synthetic_${serial}`,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: `Synthetic response ${serial}`, annotations: [] }],
  };
  const emit = (type, fields) =>
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  emit("response.created", {
    response: { id: `resp_${serial}`, object: "response", status: "in_progress", output: [] },
  });
  emit("response.output_item.added", {
    output_index: 0,
    item: { ...item, status: "in_progress", content: [] },
  });
  emit("response.content_part.added", {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });
  emit("response.output_text.delta", {
    item_id: item.id,
    output_index: 0,
    content_index: 0,
    delta: item.content[0].text,
  });
  emit("response.output_item.done", { output_index: 0, item });
  emit("response.completed", {
    response: {
      id: `resp_${serial}`,
      object: "response",
      status: "completed",
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  response.end();
}
async function runtime(t) {
  assert.ok(path.isAbsolute(binary));
  const root = await realpath(await mkdtemp("/tmp/shark-cdx-"));
  const home = path.join(root, ".codex");
  await mkdir(home, { mode: 0o700 });
  const socketPath = path.join(root, "owner.sock");
  const requests = [],
    held = [];
  let hold = false,
    child;
  const peers = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
    requests.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (hold) held.push({ response: res, serial: requests.length });
    else finish(res, requests.length);
  });
  t.after(async () => {
    for (const peer of peers) peer.close();
    for (const item of held) item.response.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGKILL");
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await writeFile(
    path.join(home, "config.toml"),
    `model="gpt-5.4"\nmodel_provider="shark_test"\napproval_policy="never"\nsandbox_mode="read-only"\n[model_providers.shark_test]\nname="SHark synthetic test"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[features]\nremote_models=false\n`,
    { mode: 0o600 },
  );
  child = spawn(binary, ["app-server", "--listen", `unix://${socketPath}`], {
    cwd: root,
    env: { HOME: root, CODEX_HOME: home, PATH: "/usr/bin:/bin", RUST_LOG: "error" },
    stdio: "ignore",
  });
  // Startup errors are bounded by until; no production environment is inherited.
  child.on("error", () => {});
  const owner = { adapterData: { socketPath } };
  const rpc = await until(async () => {
    try {
      return await connectCodex(owner, { timeout: 1000 });
    } catch {
      return null;
    }
  }, Boolean);
  peers.push(rpc);
  const { thread } = await rpc.request("thread/start", { cwd: root, model: "gpt-5.4" });
  const session = {
    version: 1,
    harness: "codex",
    sessionId: thread.id,
    cwd: root,
    adapterData: { socketPath },
  };
  const adapter = new CodexAdapter();
  return {
    root,
    session,
    adapter,
    rpc,
    requests,
    child,
    hold: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      for (const item of held.splice(0)) finish(item.response, item.serial);
    },
    held,
  };
}

test(
  "installed Codex: idle completion reply starts once, persists, and reconciles without resending",
  options,
  async (t) => {
    const r = await runtime(t);
    await r.rpc.request("turn/start", {
      threadId: r.session.sessionId,
      input: [{ type: "text", text: "Synthetic task before completion" }],
    });
    await until(
      () => r.rpc.request("thread/read", { threadId: r.session.sessionId }),
      (value) => value.thread.status.type === "idle",
    );
    const f = await fixture(t);
    let crash = true;
    const broker = f.broker({
      adapter: undefined,
      checkpoint: async (point) => {
        if (point === "after_admission" && crash) {
          crash = false;
          throw new Error("synthetic broker crash");
        }
      },
    });
    const registered = await broker.register({ ...completion(), session: r.session });
    f.answer(registered.id, "Literal reply $(not-a-command)");
    f.advance(60_000);
    await assert.rejects(broker.process(registered.id), /synthetic broker crash/);
    const nativeInput = f.store.get(registered.id).data.nativeInput;
    await until(
      () => r.adapter.reconcile(r.session, nativeInput),
      (value) => value.status === "accepted" && value.receipt.location === "history",
    );
    const recovered = await f
      .broker({ store: await f.open(), adapter: undefined })
      .process(registered.id);
    assert.equal(recovered.state, "delivered");
    assert.equal(r.requests.length, 2);
    const history = await r.rpc.request("thread/turns/list", {
      threadId: r.session.sessionId,
      itemsView: "full",
    });
    const messages = history.data
      .flatMap((turn) => turn.items)
      .filter((item) => item.clientId === nativeInput.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content[0].text, nativeInput.text);
    assert.equal(f.store.get(registered.id).data.nativeReceipt.threadId, r.session.sessionId);
  },
);

test(
  "installed Codex: busy task keeps deferred reply queued and runs it after current completion",
  options,
  async (t) => {
    const r = await runtime(t);
    r.hold();
    await r.rpc.request("turn/start", {
      threadId: r.session.sessionId,
      input: [{ type: "text", text: "Synthetic initial task" }],
    });
    await until(
      async () => r.held.length,
      (count) => count === 1,
    );
    const f = await fixture(t);
    const broker = f.broker({ adapter: undefined });
    const registered = await broker.register({ ...completion(), session: r.session });
    f.answer(registered.id);
    f.advance(60_000);
    assert.equal((await broker.process(registered.id)).state, "delivered");
    assert.equal(f.store.get(registered.id).data.nativeReceipt.location, "queue");
    assert.equal(r.requests.length, 1);
    r.release();
    await until(
      async () => r.requests.length,
      (count) => count === 2,
    );
    const input = f.store.get(registered.id).data.nativeInput;
    await until(
      () => r.adapter.reconcile(r.session, input),
      (value) => value.status === "accepted" && value.receipt.location === "history",
    );
    assert.equal(r.requests.length, 2);
    assert.equal(
      (await r.rpc.request("thread/queue/list", { threadId: r.session.sessionId })).data.length,
      0,
    );
  },
);
