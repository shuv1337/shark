import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";
import { connectCodex } from "../src/adapters/codex-rpc.mjs";

async function peer(t, respond) {
  const root = await mkdtemp("/tmp/shark-rpc-");
  const socketPath = path.join(root, "owner.sock");
  const http = createServer();
  const server = new WebSocketServer({ server: http });
  const calls = [];
  server.on("connection", (ws) =>
    ws.on("message", (raw) => {
      const request = JSON.parse(raw);
      calls.push(request);
      if (request.method === "initialize") ws.send(JSON.stringify({ id: request.id, result: {} }));
      else if (request.id) respond(ws, request);
    }),
  );
  await new Promise((resolve) => http.listen(socketPath, resolve));
  t.after(async () => {
    for (const ws of server.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => http.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, socketPath, session: { adapterData: { socketPath } }, calls };
}

test("Codex transport initializes its native Unix WebSocket and ignores server tool requests", async (t) => {
  const p = await peer(t, (ws, request) => {
    ws.send(
      JSON.stringify({ id: "native-request", method: "item/tool/requestUserInput", params: {} }),
    );
    ws.send(JSON.stringify({ id: request.id, result: { synthetic: true } }));
  });
  const rpc = await connectCodex(p.session);
  t.after(() => rpc.close());
  assert.deepEqual(await rpc.request("thread/read", { threadId: "synthetic" }), {
    synthetic: true,
  });
  assert.deepEqual(
    p.calls.map((item) => item.method),
    ["initialize", "initialized", "thread/read"],
  );
  assert.equal(
    p.calls.some((item) => item.id === "native-request"),
    false,
  );
});

test("Codex transport refuses insecure directories, sockets, regular files and symlinks", async (t) => {
  const p = await peer(t, () => {});
  await chmod(p.root, 0o755);
  await assert.rejects(connectCodex(p.session), /codex_owner_unavailable/);
  await chmod(p.root, 0o700);
  await chmod(p.socketPath, 0o666);
  await assert.rejects(connectCodex(p.session), /codex_owner_unavailable/);
  const file = path.join(p.root, "regular");
  await writeFile(file, "synthetic", { mode: 0o600 });
  await assert.rejects(
    connectCodex({ adapterData: { socketPath: file } }),
    /codex_owner_unavailable/,
  );
  const link = path.join(p.root, "link");
  await symlink(p.socketPath, link);
  await assert.rejects(
    connectCodex({ adapterData: { socketPath: link } }),
    /codex_owner_unavailable/,
  );
});

test("Codex transport bounds unresponsive requests and redacts native error content", async (t) => {
  const p = await peer(t, (ws, request) => {
    if (request.method === "reject")
      ws.send(
        JSON.stringify({ id: request.id, error: { message: "synthetic private transcript" } }),
      );
  });
  const rpc = await connectCodex(p.session, { timeout: 50 });
  await assert.rejects(
    rpc.request("reject", {}),
    (error) => error.message === "codex_request_rejected",
  );
  await assert.rejects(rpc.request("no-response", {}), /codex_connection_lost/);
  await assert.rejects(rpc.request("after-close", {}), /codex_connection_lost/);
});

for (const invalid of ["not-json", "null", "[]"])
  test(`Codex transport closes on malformed RPC ${invalid}`, async (t) => {
    const p = await peer(t, (ws) => ws.send(invalid));
    const rpc = await connectCodex(p.session);
    await assert.rejects(rpc.request("thread/read", {}), /codex_connection_lost/);
  });
