import { lstat } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import WebSocket from "ws";
import { BrokerError } from "../errors.mjs";

// Attach to the existing owner over its local WebSocket transport. Never start
// another app-server, read its database, or take ownership as a fallback.
export async function connectCodex(session, { timeout = 5000 } = {}) {
  const { socketPath } = session.adapterData;
  const directory = await lstat(path.dirname(socketPath));
  const stat = await lstat(socketPath);
  if (
    !directory.isDirectory() ||
    (directory.mode & 0o777) !== 0o700 ||
    (process.getuid && directory.uid !== process.getuid()) ||
    !stat.isSocket() ||
    (process.getuid && stat.uid !== process.getuid()) ||
    stat.mode & 0o022
  )
    throw new BrokerError(6, "codex_owner_unavailable");
  const ws = new WebSocket("ws://localhost/", {
    createConnection: () => connect(socketPath),
    handshakeTimeout: timeout,
    maxPayload: 8 * 1024 * 1024,
    perMessageDeflate: false,
    followRedirects: false,
  });
  const pending = new Map();
  let serial = 0,
    closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new BrokerError(6, "codex_connection_lost"));
    }
    pending.clear();
    ws.terminate();
  };
  ws.on("error", close);
  ws.on("close", close);
  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      close();
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      close();
      return;
    }
    // Ignore events and never answer another client's native tool requests.
    if (message.method) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new BrokerError(6, "codex_request_rejected"));
    else waiter.resolve(message.result);
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (closed) return reject(new BrokerError(6, "codex_connection_lost"));
      const id = `shark_${++serial}`;
      const timer = setTimeout(close, timeout);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) close();
      });
    });
  try {
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    await request("initialize", {
      clientInfo: { name: "shark_reply_broker", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    ws.send(JSON.stringify({ method: "initialized" }));
    return { request, close };
  } catch (error) {
    close();
    throw error;
  }
}
