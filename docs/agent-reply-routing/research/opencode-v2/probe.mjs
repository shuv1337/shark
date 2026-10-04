import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A disposable installed-binary admission probe. Never connects to an existing
// server. No credentials or inherited agent configuration enter the child.
const output = path.dirname(fileURLToPath(import.meta.url));
const executionProbe = process.argv.includes("--execution");
const binary =
  process.argv.slice(2).find((arg) => arg !== "--execution") ??
  "/Users/shuv/.bun/install/global/node_modules/shuvcode-darwin-arm64/bin/shuvcode";
assert.equal(
  process.platform,
  "darwin",
  "This probe requires the macOS loopback-only sandbox profile",
);
const root = await mkdtemp(path.join(output, ".probe-"));
const password = randomBytes(32).toString("base64url");
let modelRequestCount = 0;
let releaseFirstModel;
const fakeModel = createServer(async (request, response) => {
  for await (const _chunk of request) {
    /* Consume synthetic request without storing it. */
  }
  modelRequestCount += 1;
  const ordinal = modelRequestCount;
  if (ordinal === 1)
    await new Promise((resolve) => {
      releaseFirstModel = resolve;
    });
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const frame = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`);
  frame({
    id: `synthetic-completion-${ordinal}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "synthetic",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "Synthetic fixture completion." },
        finish_reason: null,
      },
    ],
  });
  frame({
    id: `synthetic-completion-${ordinal}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "synthetic",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  response.end("data: [DONE]\n\n");
});
await new Promise((resolve) => fakeModel.listen(0, "127.0.0.1", resolve));
const env = {
  PATH: "/opt/homebrew/bin:/usr/bin:/bin",
  OPENCODE_TEST_HOME: root,
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_STATE_HOME: path.join(root, "state"),
  TMPDIR: path.join(root, "tmp"),
  OPENCODE_CONFIG_DIR: path.join(root, "config"),
  OPENCODE_DB: path.join(root, "probe.db"),
  OPENCODE_PASSWORD: password,
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_PROJECT_CONFIG: "1",
  OPENCODE_DISABLE_FILEWATCHER: "1",
  OPENCODE_DISABLE_FFF: "1",
  SHARK_PROBE_API_KEY: "synthetic-noncredential",
};
await Promise.all(
  ["config", "data", "cache", "state", "tmp", "project", "moved"].map((name) =>
    mkdir(path.join(root, name), { mode: 0o700 }),
  ),
);
await writeFile(
  path.join(root, "config", "opencode.json"),
  JSON.stringify({
    autoupdate: false,
    permissions: [{ action: "*", resource: "*", effect: "ask" }],
    providers: {
      "shark-probe": {
        package: "@ai-sdk/openai-compatible",
        env: ["SHARK_PROBE_API_KEY"],
        settings: {
          baseURL: `http://127.0.0.1:${fakeModel.address().port}/v1`,
          name: "shark-probe",
        },
        models: {
          synthetic: {
            name: "Synthetic fixture",
            limit: { context: 8192, output: 100 },
            capabilities: { tools: false, input: ["text"], output: ["text"] },
          },
        },
      },
    },
  }),
  { mode: 0o600 },
);
const profile =
  '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))';
const sandboxed = process.platform === "darwin";
const command = sandboxed ? "/usr/bin/sandbox-exec" : binary;
const prefix = sandboxed ? ["-p", profile, binary] : [];
const evidence = {
  observedAt: new Date().toISOString(),
  binary,
  binarySha256: createHash("sha256")
    .update(await readFile(binary))
    .digest("hex"),
  version: spawnSync(command, [...prefix, "--version"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 15000,
  }).stdout.trim(),
  executionProbe,
  isolation: {
    freshXdgDirectories: true,
    freshConfig: true,
    inheritedCredentials: false,
    nonLoopbackNetworkDenied: sandboxed,
    externalModelExecution: false,
    syntheticModelTransport: true,
  },
  checks: [],
};
let child;
let base;
let shutdown;
let logs = "";
async function start() {
  logs = "";
  child = spawn(
    command,
    [...prefix, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0", "--print-logs"],
    { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  shutdown = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });
  base = await new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("Disposable server startup timeout")), 20000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      for (const line of stdout.split("\n")) {
        try {
          const parsed = JSON.parse(line);
          if (typeof parsed.url !== "string") continue;
          const url = new URL(parsed.url);
          assert.equal(url.hostname, "127.0.0.1");
          clearTimeout(timer);
          resolve(url.origin);
        } catch {
          /* Ignore startup text; never persist it. */
        }
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Disposable server exited during startup (${code})`));
    });
  });
}
async function stop(signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  const result = await shutdown;
  clearTimeout(timer);
  return result;
}
async function request(method, pathname, body, options = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(options.timeout ?? 8000),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { status: response.status, data };
}
function record(name, result) {
  evidence.checks.push({ name, ...result });
}
async function waitFor(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  await start();
  const api = await request("GET", "/openapi.json");
  assert.equal(api.status, 200);
  const selectedPaths = Object.fromEntries(
    Object.entries(api.data.paths).filter(([name]) =>
      /session|permission|form|question|event/.test(name),
    ),
  );
  await writeFile(
    path.join(output, "api-summary.json"),
    `${JSON.stringify(
      {
        info: api.data.info,
        openapiSha256: createHash("sha256").update(JSON.stringify(api.data)).digest("hex"),
        paths: Object.fromEntries(
          Object.entries(selectedPaths).map(([pathname, operations]) => [
            pathname,
            Object.fromEntries(
              Object.entries(operations).map(([method, operation]) => [
                method,
                {
                  operationId: operation.operationId,
                  description: operation.description,
                  responseStatuses: Object.keys(operation.responses ?? {}),
                },
              ]),
            ),
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  record("installed-openapi", { status: api.status, routes: Object.keys(selectedPaths) });
  const created = await request("POST", "/api/session", {
    id: "ses_shark_probe_a",
    title: "Synthetic admission probe",
    location: { directory: path.join(root, "project") },
  });
  record("create-disposable-session", {
    status: created.status,
    sessionId: created.data?.data?.id,
    error: created.data?._tag,
  });
  assert.equal(created.status, 200);
  const sessionId = created.data.data.id;
  const endpoint = `/api/session/${encodeURIComponent(sessionId)}`;
  const list = await request("GET", "/api/session");
  record("second-client-discovery", {
    status: list.status,
    found: list.data.data.some((s) => s.id === sessionId),
  });
  const missing = await request("GET", "/api/session/ses_shark_probe_missing");
  record("definitive-missing", { status: missing.status, error: missing.data?._tag });
  const prompt = {
    id: "msg_shark_probe_delivery_1",
    text: "Synthetic inert input $(echo never-execute)",
    metadata: { deliveryId: "shark-probe-delivery-1" },
    delivery: "queue",
    resume: false,
  };
  const admitted = await request("POST", `${endpoint}/prompt`, prompt);
  record("admit-only", {
    status: admitted.status,
    id: admitted.data?.data?.id,
    delivery: admitted.data?.data?.delivery,
    responseKeys: Object.keys(admitted.data?.data ?? {}),
  });
  assert.equal(admitted.status, 200);
  const duplicate = await request("POST", `${endpoint}/prompt`, prompt);
  record("exact-duplicate", {
    status: duplicate.status,
    sameAdmission: JSON.stringify(admitted.data) === JSON.stringify(duplicate.data),
  });
  assert.deepEqual(duplicate, admitted);
  const conflict = await request("POST", `${endpoint}/prompt`, {
    ...prompt,
    text: "Conflicting synthetic input",
  });
  record("changed-payload-reuse-first-wins", {
    status: conflict.status,
    originalPayloadRetained: JSON.stringify(conflict.data) === JSON.stringify(admitted.data),
  });
  assert.deepEqual(conflict, admitted);
  const changedDelivery = await request("POST", `${endpoint}/prompt`, {
    ...prompt,
    delivery: "steer",
  });
  record("changed-delivery-first-wins", {
    status: changedDelivery.status,
    originalDeliveryRetained: changedDelivery.data?.data?.delivery === "queue",
  });
  assert.equal(changedDelivery.data.data.delivery, "queue");
  await request("POST", "/api/session", {
    id: "ses_shark_probe_b",
    location: { directory: path.join(root, "project") },
  });
  const otherSession = await request("POST", "/api/session/ses_shark_probe_b/prompt", prompt);
  record("cross-session-id-conflict", {
    status: otherSession.status,
    error: otherSession.data?._tag,
  });
  assert.equal(otherSession.status, 409);
  const queueRoute = api.data.paths[`${endpoint}/inbox`]
    ? "/inbox"
    : Object.keys(api.data.paths).some((p) => p.endsWith("/inbox"))
      ? "/inbox"
      : "/pending";
  const pending = await request("GET", endpoint + queueRoute);
  record("durable-queue", {
    status: pending.status,
    count: pending.data?.data?.length,
    route: queueRoute,
  });
  assert.equal(pending.data.data.length, 1);
  const active = await request("GET", "/api/session/active");
  record("admit-only-is-inactive", {
    status: active.status,
    active: Object.hasOwn(active.data.data, sessionId),
  });
  assert.equal(Object.hasOwn(active.data.data, sessionId), false);
  const missingPrompt = await request(
    "POST",
    "/api/session/ses_shark_probe_missing/prompt",
    prompt,
  );
  record("missing-prompt", { status: missingPrompt.status, error: missingPrompt.data?._tag });
  const log = await request(
    "GET",
    `/api/experimental/session/${sessionId}/log?after=0&follow=false`,
  );
  const events =
    typeof log.data === "string"
      ? log.data
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice(5)))
      : [];
  record("durable-log", {
    status: log.status,
    events: events.map((item) => ({ type: item.type, seq: item.seq, id: item.id })),
  });
  const formId = "frm_shark_probe_race";
  const form = await request("POST", `${endpoint}/form`, {
    id: formId,
    title: "Synthetic choice",
    fields: [{ key: "choice", type: "string", required: true }],
  });
  record("form-create", { status: form.status, formId: form.data?.data?.id });
  assert.equal(form.status, 200);
  const formReplies = await Promise.all(
    ["desktop", "phone"].map((choice) =>
      request("POST", `${endpoint}/form/${formId}/reply`, { answer: { choice } }),
    ),
  );
  const formState = await request("GET", `${endpoint}/form/${formId}/state`);
  record("form-competing-replies", {
    statuses: formReplies.map((r) => r.status),
    errors: formReplies.map((r) => r.data?._tag),
    state: formState.data?.data?.status,
    winner: formState.data?.data?.answer?.choice,
  });
  const settledForm = await request("POST", `${endpoint}/form/${formId}/reply`, {
    answer: { choice: "late" },
  });
  record("form-late-reply", { status: settledForm.status, error: settledForm.data?._tag });
  const pendingForm = await request("POST", `${endpoint}/form`, {
    id: "frm_shark_probe_pending",
    title: "Synthetic pending choice",
    fields: [{ key: "choice", type: "string" }],
  });
  assert.equal(pendingForm.status, 200);
  const permission = await request("POST", `${endpoint}/permission`, {
    id: "per_shark_probe",
    action: "external_directory",
    resources: ["synthetic"],
    agent: "build",
  });
  record("permission-evaluate", {
    status: permission.status,
    effect: permission.data?.data?.effect,
    error: permission.data?._tag,
  });
  if (permission.data?.data?.effect === "ask") {
    const permissionReplies = await Promise.all(
      ["once", "reject"].map((reply) =>
        request("POST", `${endpoint}/permission/per_shark_probe/reply`, { reply }),
      ),
    );
    const permissionState = await request("GET", `${endpoint}/permission/per_shark_probe`);
    record("permission-competing-replies", {
      statuses: permissionReplies.map((r) => r.status),
      errors: permissionReplies.map((r) => r.data?._tag),
      postReplyStatus: permissionState.status,
    });
  }
  const lostPrompt = {
    ...prompt,
    id: "msg_shark_probe_delivery_lost",
    metadata: { deliveryId: "shark-probe-delivery-lost" },
  };
  let upstreamAdmission;
  const lossProxy = createServer(async (_request, response) => {
    upstreamAdmission = await request("POST", `${endpoint}/prompt`, lostPrompt);
    response.destroy();
  });
  await new Promise((resolve) => lossProxy.listen(0, "127.0.0.1", resolve));
  let lostResponse = false;
  try {
    await fetch(`http://127.0.0.1:${lossProxy.address().port}`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    lostResponse = true;
  }
  await new Promise((resolve) => lossProxy.close(resolve));
  record("lost-admission-response", {
    clientOutcome: lostResponse ? "unknown" : "received",
    upstreamStatus: upstreamAdmission?.status,
  });
  assert.equal(lostResponse, true);
  assert.equal(upstreamAdmission.status, 200);
  await stop("SIGKILL");
  await start();
  const afterCrash = await request("POST", `${endpoint}/prompt`, prompt);
  record("restart-and-exact-replay", {
    status: afterCrash.status,
    sameAdmission: JSON.stringify(admitted.data) === JSON.stringify(afterCrash.data),
  });
  assert.deepEqual(afterCrash, admitted);
  const lostReplay = await request("POST", `${endpoint}/prompt`, lostPrompt);
  record("lost-response-replay-after-crash", {
    status: lostReplay.status,
    sameAdmission: JSON.stringify(lostReplay.data) === JSON.stringify(upstreamAdmission.data),
  });
  assert.deepEqual(lostReplay, upstreamAdmission);
  const afterCrashQueue = await request("GET", endpoint + queueRoute);
  record("restart-queue-count", {
    status: afterCrashQueue.status,
    count: afterCrashQueue.data?.data?.length,
  });
  assert.equal(afterCrashQueue.data.data.length, 2);
  const restartForm = await request("GET", `${endpoint}/form/${formId}/state`);
  const restartPending = await request("GET", `${endpoint}/form/frm_shark_probe_pending/state`);
  record("form-state-after-process-crash", {
    answeredStatus: restartForm.status,
    answeredError: restartForm.data?._tag,
    pendingStatus: restartPending.status,
    pendingError: restartPending.data?._tag,
  });
  if (executionProbe) {
    const executionId = "ses_shark_probe_execution";
    const executionEndpoint = `/api/session/${executionId}`;
    const executionCreated = await request("POST", "/api/session", {
      id: executionId,
      title: "Synthetic execution fixture",
      model: { providerID: "shark-probe", id: "synthetic" },
      location: { directory: path.join(root, "project") },
    });
    assert.equal(executionCreated.status, 200);
    const firstRunningPrompt = {
      id: "msg_shark_probe_running_1",
      text: "First synthetic turn",
      delivery: "queue",
    };
    const executionAdmission = await request(
      "POST",
      `${executionEndpoint}/prompt`,
      firstRunningPrompt,
    );
    record("wake-synthetic-execution", { status: executionAdmission.status });
    await waitFor(() => modelRequestCount === 1, "loopback synthetic model request");
    const whileActive = await request("GET", "/api/session/active");
    record("busy-session", {
      status: whileActive.status,
      active: Object.hasOwn(whileActive.data.data, executionId),
    });
    const queuedWhileBusy = await request("POST", `${executionEndpoint}/prompt`, {
      id: "msg_shark_probe_running_2",
      text: "Second synthetic turn",
      delivery: "queue",
    });
    const busyInbox = await request("GET", `${executionEndpoint}/inbox`);
    record("queue-while-busy", {
      status: queuedWhileBusy.status,
      pendingCount: busyInbox.data?.data?.length,
    });
    releaseFirstModel();
    const waited = await request("POST", `${executionEndpoint}/wait`);
    const executionContext = await request("GET", `${executionEndpoint}/context`);
    record("serialized-two-prompts", {
      waitStatus: waited.status,
      modelRequestCount,
      contextStatus: executionContext.status,
      contextKeys: Object.keys(executionContext.data?.data ?? {}),
    });
    const promotedRetry = await request("POST", `${executionEndpoint}/prompt`, {
      ...firstRunningPrompt,
      resume: false,
    });
    record("promoted-prompt-retry", {
      status: promotedRetry.status,
      id: promotedRetry.data?.data?.id,
      noAdditionalModelCall: modelRequestCount === 2,
    });
    const executionLog = await request(
      "GET",
      `/api/experimental/session/${executionId}/log?after=0&follow=false`,
    );
    const executionEvents =
      typeof executionLog.data === "string"
        ? executionLog.data
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => JSON.parse(line.slice(5)))
        : [];
    record("execution-lifecycle-log", {
      status: executionLog.status,
      events: executionEvents.map((item) => ({ type: item.type, seq: item.seq, id: item.id })),
    });
  }
  const removed = await request("DELETE", endpoint);
  const afterDelete = await request("GET", endpoint);
  record("deleted-session", {
    removeStatus: removed.status,
    getStatus: afterDelete.status,
    error: afterDelete.data?._tag,
  });
  assert.equal(afterDelete.status, 404);
  evidence.result = "passed";
} catch (error) {
  evidence.result = "failed";
  evidence.failure = {
    name: error.name,
    message: error.message.replaceAll(root, "<disposable-root>").replaceAll(password, "<redacted>"),
  };
  if (base && child && child.exitCode === null) {
    const diagnostic = await request("GET", "/api/session/ses_shark_probe_execution/context").catch(
      () => undefined,
    );
    if (diagnostic)
      evidence.executionDiagnostic = {
        status: diagnostic.status,
        messages: Array.isArray(diagnostic.data?.data)
          ? diagnostic.data.data.map((message) => ({ type: message.type, id: message.id }))
          : [],
      };
    const logDiagnostic = await request(
      "GET",
      "/api/experimental/session/ses_shark_probe_execution/log?after=0&follow=false",
    ).catch(() => undefined);
    if (logDiagnostic)
      evidence.logDiagnostic = {
        status: logDiagnostic.status,
        frames:
          typeof logDiagnostic.data === "string"
            ? logDiagnostic.data
                .split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => {
                  const value = JSON.parse(line.slice(5));
                  return { type: value.type, seq: value.seq };
                })
            : [],
      };
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(env.OPENCODE_DB, { readOnly: true });
    evidence.persistedEventRows = database
      .prepare("SELECT COUNT(*) AS count FROM event")
      .get().count;
    database.close();
    evidence.requestDiagnostics = await Promise.all(
      ["permission", "form", "inbox"].map(async (kind) => {
        const result = await request("GET", `/api/session/ses_shark_probe_execution/${kind}`);
        return { kind, status: result.status, count: result.data?.data?.length };
      }),
    );
  }
  evidence.stderrBytes = Buffer.byteLength(logs);
  process.exitCode = 1;
} finally {
  releaseFirstModel?.();
  await stop();
  fakeModel.closeAllConnections();
  await new Promise((resolve) => fakeModel.close(resolve));
  await rm(root, { recursive: true, force: true });
  await writeFile(
    path.join(output, executionProbe ? "execution-probe-result.json" : "probe-result.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      { result: evidence.result, checks: evidence.checks, failure: evidence.failure },
      null,
      2,
    ),
  );
}
