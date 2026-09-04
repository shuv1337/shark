import { createHash } from "node:crypto";
import { askSharkPermission, permissionSummary, stableIdempotencyKey } from "./ask.mjs";

const jobs = new Map();
const REQUEST_TIMEOUT_MS = 10_000;

function jobKey(serverUrl, directory, requestID) {
  return `${serverUrl}:${directory}:${requestID}`;
}

function normalize(request) {
  return {
    id: request.id,
    sessionID: request.sessionID,
    action: request.permission ?? request.type ?? "permission",
    resources: request.patterns ?? (request.pattern ? [request.pattern] : []),
    save: request.always ?? [],
    source: request.tool
      ? { messageID: request.tool.messageID, callID: request.tool.callID }
      : request.messageID && request.callID
        ? { messageID: request.messageID, callID: request.callID }
        : undefined,
  };
}

function fingerprint(request) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.id,
        request.sessionID,
        request.action,
        request.resources,
        request.save,
        request.source ?? null,
      ]),
    )
    .digest("hex");
}

function authHeaders() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return {};
  const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
  return { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}

async function request(serverUrl, path, directory, options = {}) {
  const url = new URL(path, serverUrl);
  if (directory) url.searchParams.set("directory", directory);
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      ...authHeaders(),
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = new Error(`OpenCode V1 request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined;
  return response.json();
}

async function listPending(serverUrl, directory) {
  const response = await request(serverUrl, "/permission", directory);
  if (!Array.isArray(response)) throw new Error("OpenCode V1 permission list was invalid");
  return response.map(normalize);
}

async function reply(serverUrl, directory, permission, decision) {
  try {
    await request(serverUrl, `/permission/${encodeURIComponent(permission.id)}/reply`, directory, {
      method: "POST",
      body: JSON.stringify({
        reply: decision,
        ...(decision === "reject" ? { message: "Denied through SHark." } : {}),
      }),
    });
  } catch (error) {
    if (!permission.sessionID) throw error;
    await request(
      serverUrl,
      `/session/${encodeURIComponent(permission.sessionID)}/permissions/${encodeURIComponent(permission.id)}`,
      directory,
      { method: "POST", body: JSON.stringify({ response: decision }) },
    );
  }
}

async function replyIfCurrent(serverUrl, directory, original, decision) {
  let current;
  try {
    current = (await listPending(serverUrl, directory)).find((item) => item.id === original.id);
  } catch {
    return;
  }
  if (!current || fingerprint(current) !== fingerprint(original)) return;
  await reply(serverUrl, directory, original, decision).catch(() => {});
}

function startRequest(serverUrl, directory, request, ask = askSharkPermission) {
  const permission = normalize(request);
  const id = jobKey(serverUrl, directory, permission.id);
  if (!permission.id || !permission.sessionID) return Promise.resolve();
  const existing = jobs.get(id);
  if (existing) return existing.promise;
  const job = { settled: false, promise: undefined };
  jobs.set(id, job);
  job.promise = (async () => {
    try {
      const summary = permissionSummary({
        agent: "OpenCode",
        cwd: directory,
        toolName: permission.action,
        resourceCount: permission.resources.length,
      });
      const decision = await ask({
        ...summary,
        idempotencyKey: stableIdempotencyKey("opencode-v1-permission", [
          serverUrl,
          directory,
          permission.id,
        ]),
      });
      if (!job.settled) {
        await replyIfCurrent(
          serverUrl,
          directory,
          permission,
          decision === "approved" ? "once" : "reject",
        );
      }
    } finally {
      jobs.delete(id);
    }
  })().catch(() => {});
  return job.promise;
}

async function reconcile(serverUrl, directory, ask) {
  const pending = await listPending(serverUrl, directory);
  await Promise.all(pending.map((item) => startRequest(serverUrl, directory, item, ask)));
}

export async function handleOpenCodeV1Event(
  { serverUrl, directory, event },
  ask = askSharkPermission,
) {
  try {
    if (event.type === "permission.asked" || event.type === "permission.updated") {
      await startRequest(serverUrl, directory, event.properties, ask);
    } else if (event.type === "server.connected") {
      await reconcile(serverUrl, directory, ask);
    }
  } catch {
    // V1 dispatch does not await event hooks; all failures stay contained.
  }
}
