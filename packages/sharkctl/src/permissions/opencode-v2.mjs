import { createHash } from "node:crypto";
import { askSharkPermission, permissionSummary, stableIdempotencyKey } from "./ask.mjs";
import { Service } from "./opencode-service.mjs";

const jobs = new Map();
const decisions = new Map();
const shutdown = new AbortController();
const MAX_SSE_BUFFER_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

function headers(endpoint) {
  return { ...Service.headers(endpoint) };
}

async function request(endpoint, path, options = {}) {
  const { signal, ...requestOptions } = options;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(new URL(path, endpoint.url), {
    ...requestOptions,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: {
      ...headers(endpoint),
      ...(requestOptions.body ? { "content-type": "application/json" } : {}),
      ...requestOptions.headers,
    },
  });
  if (!response.ok) {
    const error = new Error(`OpenCode request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined;
  return response.json();
}

async function* subscribe(endpoint, signal) {
  const response = await fetch(new URL("/api/event", endpoint.url), {
    headers: headers(endpoint),
    signal,
  });
  if (!response.ok || !response.body)
    throw new Error(`OpenCode event stream failed: ${response.status}`);
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(buffer) > MAX_SSE_BUFFER_BYTES) {
      throw new Error("OpenCode event exceeded the buffer limit");
    }
    while (true) {
      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary < 0) break;
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data);
    }
  }
}

export function createOpenCodeClient(endpoint) {
  return {
    debug: {
      location: {
        list: () => request(endpoint, "/api/debug/location"),
      },
    },
    permission: {
      request: {
        list: ({ location } = {}) => {
          const url = new URL("/api/permission/request", endpoint.url);
          if (location?.directory) url.searchParams.set("location[directory]", location.directory);
          if (location?.workspace) url.searchParams.set("location[workspace]", location.workspace);
          return request(endpoint, url);
        },
      },
      get: async ({ sessionID, requestID }) => {
        const response = await request(
          endpoint,
          `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}`,
        );
        return response.data;
      },
      reply: ({ sessionID, requestID, reply, message }) =>
        request(
          endpoint,
          `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`,
          {
            method: "POST",
            body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
          },
        ),
    },
    event: {
      subscribe: ({ signal } = {}) => subscribe(endpoint, signal),
    },
  };
}

function key(request) {
  return `${request.sessionID}:${request.id}`;
}

function decisionKey(request, location) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.sessionID,
        location?.directory ?? null,
        request.action,
        [...(request.resources ?? [])].sort(),
      ]),
    )
    .digest("hex");
}

export function coalescedPermissionDecision(request, location, ask = askSharkPermission) {
  const id = decisionKey(request, location);
  const existing = decisions.get(id);
  if (existing) return existing;
  const summary = permissionSummary({
    agent: "OpenCode",
    cwd: location?.directory,
    toolName: request.action,
    resourceCount: request.resources.length,
  });
  const decision = ask({
    ...summary,
    idempotencyKey: stableIdempotencyKey("opencode-permission", [request.sessionID, request.id]),
  });
  decisions.set(id, decision);
  const cleanup = () => {
    if (decisions.get(id) === decision) decisions.delete(id);
  };
  void decision.then(cleanup, cleanup);
  return decision;
}

function fingerprint(request) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        request.id,
        request.sessionID,
        request.action,
        request.resources,
        request.save ?? null,
        request.source ?? null,
      ]),
    )
    .digest("hex");
}

async function replyIfCurrent(client, original, reply) {
  let current;
  try {
    current = await client.permission.get({
      sessionID: original.sessionID,
      requestID: original.id,
    });
  } catch {
    return;
  }
  if (fingerprint(current) !== fingerprint(original)) return;
  try {
    await client.permission.reply({
      sessionID: original.sessionID,
      requestID: original.id,
      reply,
      ...(reply === "reject" ? { message: "Denied through SHark." } : {}),
    });
  } catch {
    // The exact request may have been answered by another client.
  }
}

function startRequest(client, request, location) {
  const id = key(request);
  if (jobs.has(id)) return;
  const job = { settled: false };
  jobs.set(id, job);
  void (async () => {
    try {
      const decision = await coalescedPermissionDecision(request, location);
      if (!job.settled) {
        await replyIfCurrent(client, request, decision === "approved" ? "once" : "reject");
      }
    } catch {
      if (!job.settled) await replyIfCurrent(client, request, "reject");
    } finally {
      jobs.delete(id);
    }
  })();
}

function settleRequest(sessionID, requestID) {
  const job = jobs.get(`${sessionID}:${requestID}`);
  if (job) job.settled = true;
  jobs.delete(`${sessionID}:${requestID}`);
}

async function reconcile(client) {
  const locations = await client.debug.location.list();
  await Promise.all(
    locations.map(async (location) => {
      try {
        const pending = await client.permission.request.list({
          location: {
            directory: location.directory,
            ...(location.workspaceID ? { workspace: location.workspaceID } : {}),
          },
        });
        for (const item of pending.data) startRequest(client, item, pending.location);
      } catch {
        // A location can disappear while reconciliation is running.
      }
    }),
  );
}

async function connect() {
  const endpoint = await Service.discover();
  if (!endpoint) return undefined;
  return createOpenCodeClient(endpoint);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runOpenCodeV2Bridge() {
  process.on("SIGINT", () => shutdown.abort());
  process.on("SIGTERM", () => shutdown.abort());
  while (!shutdown.signal.aborted) {
    const client = await connect().catch(() => undefined);
    if (!client) {
      await sleep(1000);
      continue;
    }
    let timer;
    try {
      await reconcile(client);
      timer = setInterval(() => void reconcile(client).catch(() => {}), 30_000);
      for await (const event of client.event.subscribe({ signal: shutdown.signal })) {
        if (event.type === "permission.asked") {
          startRequest(client, event.data, event.location);
        } else if (event.type === "permission.replied") {
          settleRequest(event.data.sessionID, event.data.requestID);
        }
      }
      if (!shutdown.signal.aborted) await sleep(1000);
    } catch {
      if (!shutdown.signal.aborted) await sleep(1000);
    } finally {
      if (timer) clearInterval(timer);
    }
  }
}
