// Installed-runtime probe; fake loopback Responses API, fresh HOME, no credentials.
import { spawn } from "node:child_process";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { gunzipSync } from "node:zlib";
import { summarizeEvidence } from "./summarize.mjs";

const base = dirname(fileURLToPath(import.meta.url));
// A short path is required by the native macOS Unix socket SUN_LEN limit.
const runtime = await mkdtemp("/tmp/shark-codex-probe-");
const codexHome = join(runtime, ".codex");
await mkdir(codexHome);
const binary =
  process.env.SHARK_PROBE_CODEX ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const env = {
  HOME: runtime,
  CODEX_HOME: codexHome,
  PATH: "/usr/bin:/bin:/opt/homebrew/bin",
  TMPDIR: tmpdir(),
  LANG: "en_US.UTF-8",
  RUST_LOG: "error",
};
const evidence = {
  runtimeVersion: "0.153.4",
  model: "credential-free synthetic loopback",
  observations: [],
};
function narrow(value) {
  if (Array.isArray(value)) return value.map(narrow);
  if (!value || typeof value !== "object") return value;
  if ("historyMode" in value && "sessionId" in value && "turns" in value) {
    return Object.fromEntries(
      [
        "id",
        "sessionId",
        "source",
        "threadSource",
        "historyMode",
        "status",
        "canAcceptDirectInput",
        "turns",
      ].map((key) => [key, narrow(value[key])]),
    );
  }
  if ("itemsView" in value && "items" in value && "status" in value) {
    return Object.fromEntries(
      ["id", "status", "itemsView", "items", "error"].map((key) => [key, narrow(value[key])]),
    );
  }
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, narrow(v)]));
}
const record = (name, value) => {
  value = narrow(value);
  evidence.observations.push({ name, value });
  console.log(JSON.stringify({ name, value }));
};
const sockets = new Set();
const clients = [];
const servers = [];
const terminals = [];
let child,
  childLog = "";
let modelCount = 0;
let usedNativeDaemon = false;
const modes = [];
const held = [];

function complete(res, mode = "text", serial = modelCount) {
  const responseId = `resp_synthetic_${serial}`;
  const call = mode === "tool" || typeof mode === "object";
  const item = call
    ? {
        id: `fc_synthetic_${serial}`,
        type: "function_call",
        call_id: `call_synthetic_${serial}`,
        name: mode.name ?? "probe_question",
        arguments: JSON.stringify(mode.args ?? { question: "Synthetic question" }),
        status: "completed",
      }
    : {
        id: `msg_synthetic_${serial}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: `Synthetic reply ${serial}`, annotations: [] }],
      };
  const emit = (type, fields) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  emit("response.created", {
    response: { id: responseId, object: "response", status: "in_progress", output: [] },
  });
  emit("response.output_item.added", {
    output_index: 0,
    item: { ...item, status: "in_progress", ...(call ? { arguments: "" } : { content: [] }) },
  });
  if (call)
    emit("response.function_call_arguments.delta", {
      item_id: item.id,
      output_index: 0,
      delta: item.arguments,
    });
  else {
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
  }
  emit("response.output_item.done", { output_index: 0, item });
  emit("response.completed", {
    response: {
      id: responseId,
      object: "response",
      status: "completed",
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  res.end();
}
const model = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = Buffer.concat(chunks);
  if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
  const parsed = body.length ? JSON.parse(body) : {};
  modelCount++;
  record("modelRequest", {
    serial: modelCount,
    path: req.url,
    inputCount: parsed.input?.length,
    toolNames: parsed.tools?.map((t) => t.name ?? t.type),
    syntheticToolOutputs: parsed.input?.filter(
      (i) => i.type === "function_call_output" && i.call_id?.startsWith("call_synthetic_"),
    ),
  });
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const mode = modes.shift() ?? "text";
  if (mode === "hold") {
    res.flushHeaders();
    held.push({ res, serial: modelCount });
  } else complete(res, mode);
});
model.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const modelPort = model.address().port;
await writeFile(
  join(codexHome, "config.toml"),
  `model = "gpt-5.4"\nmodel_provider = "probe"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[model_providers.probe]\nname = "Synthetic loopback probe"\nbase_url = "http://127.0.0.1:${modelPort}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n[analytics]\nenabled = false\n[features]\nremote_models = false\n`,
);

async function freePort() {
  const s = createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const port = s.address().port;
  await new Promise((resolve) => s.close(resolve));
  return port;
}
async function startServer() {
  const port = await freePort();
  child = spawn(binary, ["app-server", "--listen", `ws://127.0.0.1:${port}`], {
    env,
    cwd: runtime,
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.push(child);
  child.stdout.on("data", (x) => {
    childLog += x;
  });
  child.stderr.on("data", (x) => {
    childLog += x;
  });
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}: ${childLog}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/readyz`)).ok) return port;
    } catch {}
    await delay(50);
  }
  throw new Error("Server never became ready");
}
async function connect(port, name, providedTransport) {
  const ws = providedTransport ?? new WebSocket(`ws://127.0.0.1:${port}`);
  if (!providedTransport) {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
  }
  const pending = new Map();
  const events = [];
  let next = 0;
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (!msg.method && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else events.push(msg);
  };
  const c = {
    name,
    ws,
    events,
    async request(method, params) {
      const id = `${name}_${++next}`;
      const promise = new Promise((resolve) => pending.set(id, resolve));
      ws.send(JSON.stringify({ id, method, params }));
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timeout ${method}`)), 15000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    respond(id, result) {
      ws.send(JSON.stringify({ id, result }));
    },
    async event(method, predicate = () => true, start = 0, ms = 10000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const found = events.slice(start).find((e) => e.method === method && predicate(e));
        if (found) return found;
        await delay(20);
      }
      throw new Error(
        `No ${method} event on ${name}; seen ${events
          .slice(start)
          .map((e) => e.method)
          .join(",")}`,
      );
    },
  };
  clients.push(c);
  record(
    `${name}.initialize`,
    await c.request("initialize", {
      clientInfo: { name: `shark_probe_${name}`, version: "0.0.0" },
      capabilities: { experimentalApi: true },
    }),
  );
  ws.send(JSON.stringify({ method: "initialized" }));
  return c;
}
const input = (text) => [{ type: "text", text, text_elements: [] }];
const read = (c, threadId) => c.request("thread/read", { threadId, includeTurns: true });
async function idle(c, threadId, minimumTurns = 0) {
  for (let n = 0; n < 100; n++) {
    const state = await read(c, threadId);
    const queue = await c.request("thread/queue/list", { threadId });
    if (
      state.result?.thread.status.type === "idle" &&
      queue.result?.data.length === 0 &&
      state.result.thread.turns.length >= minimumTurns &&
      state.result.thread.turns.every((t) => t.status !== "inProgress")
    )
      return;
    await delay(25);
  }
  throw new Error("Thread did not become idle with an empty queue");
}
async function stopServer(server, signal = "SIGKILL") {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill(signal);
  await exited;
}
try {
  const port = await startServer();
  const a = await connect(port, "desktop");
  const b = await connect(port, "observer");
  const start = await a.request("thread/start", {
    cwd: runtime,
    model: "gpt-5.4",
    modelProvider: "probe",
    approvalPolicy: "never",
    sandbox: "read-only",
    dynamicTools: [
      {
        type: "function",
        name: "probe_question",
        description: "Synthetic bounded admission probe",
        inputSchema: {
          type: "object",
          properties: { question: { type: "string" } },
          required: ["question"],
          additionalProperties: false,
        },
      },
    ],
  });
  if (start.error) throw new Error(JSON.stringify(start.error));
  const threadId = start.result.thread.id;
  record("start", {
    threadId,
    status: start.result.thread.status,
    source: start.result.thread.source,
  });
  record("observer.loaded", await b.request("thread/loaded/list", {}));
  record("observer.readBeforeTurn", await read(b, threadId));
  modes.push("hold");
  const first = await a.request("turn/start", {
    threadId,
    input: input("Synthetic first"),
    clientUserMessageId: "delivery_synthetic_first",
  });
  record("turnStart", first);
  for (let n = 0; !held.length && n < 100; n++) await delay(50);
  record("observer.resumeActive", await b.request("thread/resume", { threadId }));
  record("observer.readActive", await read(b, threadId));
  record(
    "observer.notificationMethods",
    b.events.map((e) => e.method),
  );
  const response = held.shift();
  if (!response) throw new Error(`Model request absent: ${childLog}`);
  complete(response.res, "text", response.serial);
  record("desktop.completed", await a.event("turn/completed"));
  record("observer.completed", await b.event("turn/completed"));
  record("readCompleted", await read(b, threadId));
  let mark = a.events.length;
  record(
    "repeatCompletedDelivery",
    await a.request("turn/start", {
      threadId,
      input: input("Synthetic first"),
      clientUserMessageId: "delivery_synthetic_first",
    }),
  );
  await a.event("turn/completed", () => true, mark);
  record("readAfterDuplicate", await read(b, threadId));
  modes.push("hold");
  const busy = await a.request("turn/start", {
    threadId,
    input: input("Synthetic active"),
    clientUserMessageId: "delivery_synthetic_busy",
  });
  record("busyStart", busy);
  for (let n = 0; !held.length && n < 100; n++) await delay(50);
  record(
    "busyTurnStartFromSecondClient",
    await b.request("turn/start", {
      threadId,
      input: input("Synthetic second client turn"),
      clientUserMessageId: "delivery_synthetic_second_client",
    }),
  );
  record(
    "busyRepeatSameDelivery",
    await b.request("turn/start", {
      threadId,
      input: input("Synthetic second client turn"),
      clientUserMessageId: "delivery_synthetic_second_client",
    }),
  );
  record(
    "staleSteer",
    await b.request("turn/steer", {
      threadId,
      expectedTurnId: "synthetic_stale_turn",
      input: input("Stale steer"),
      clientUserMessageId: "delivery_synthetic_stale",
    }),
  );
  record(
    "busyQueueAdd",
    await b.request("thread/queue/add", {
      threadId,
      input: input("Synthetic queued"),
      clientUserMessageId: "delivery_synthetic_queue",
    }),
  );
  record(
    "busyQueueAddDuplicate",
    await b.request("thread/queue/add", {
      threadId,
      input: input("Synthetic queued"),
      clientUserMessageId: "delivery_synthetic_queue",
    }),
  );
  record("queueList", await b.request("thread/queue/list", { threadId }));
  mark = a.events.length;
  complete(held.shift().res);
  await a.event("turn/completed", () => true, mark);
  await idle(a, threadId, 5);
  record("readAfterBusy", await read(b, threadId));
  record("queueAfterBusy", await b.request("thread/queue/list", { threadId }));
  // Active native structured input and reconnect, without a real model call.
  modes.push({
    name: "request_user_input",
    args: {
      questions: [
        {
          id: "synthetic_q",
          header: "Probe",
          question: "Synthetic question?",
          options: [
            { label: "First", description: "Synthetic first answer" },
            { label: "Second", description: "Synthetic second answer" },
          ],
        },
      ],
    },
  });
  mark = a.events.length;
  record(
    "questionTurn",
    await a.request("turn/start", {
      threadId,
      input: input("Synthetic question request"),
      clientUserMessageId: "delivery_synthetic_question",
      collaborationMode: {
        mode: "plan",
        settings: { model: "gpt-5.4", reasoning_effort: null, developer_instructions: null },
      },
    }),
  );
  const question = await a.event("item/tool/requestUserInput", () => true, mark);
  record("desktop.nativeQuestion", question);
  record("observer.nativeQuestion", await b.event("item/tool/requestUserInput"));
  const c = await connect(port, "reconnect");
  record("reconnect.readPending", await read(c, threadId));
  record("reconnect.resumePending", await c.request("thread/resume", { threadId }));
  await delay(100);
  record(
    "reconnect.pendingRequests",
    c.events.filter((e) => e.id !== undefined),
  );
  const questionC = c.events.find((e) => e.method === "item/tool/requestUserInput");
  record("nativeQuestionRequestIds", {
    desktop: question.id,
    observer: b.events.find((e) => e.method === "item/tool/requestUserInput")?.id,
    reconnect: questionC?.id,
  });
  mark = a.events.length;
  b.respond(question.id, { answers: { synthetic_q: { answers: ["First"] } } });
  await a.event("turn/completed", () => true, mark);
  a.respond(question.id, { answers: { synthetic_q: { answers: ["Second"] } } });
  await delay(100);
  record(
    "resolutionEvents",
    clients.map((client) => ({
      name: client.name,
      events: client.events.filter((e) => e.method === "serverRequest/resolved"),
    })),
  );
  record("readAfterQuestionRace", await read(c, threadId));
  record(
    "turnsPage",
    await c.request("thread/turns/list", {
      threadId,
      limit: 2,
      sortDirection: "desc",
      itemsView: "full",
    }),
  );
  record(
    "itemsPage",
    await c.request("thread/items/list", { threadId, limit: 3, sortDirection: "desc" }),
  );
  record("timelinePage", await c.request("thread/timeline/list", { threadId, limit: 3 }));

  // Native approval, always decline the synthetic echo; no command is executed.
  modes.push({
    name: "exec_command",
    args: {
      cmd: "echo synthetic_approval",
      sandbox_permissions: "require_escalated",
      justification: "Synthetic local protocol probe",
    },
  });
  mark = a.events.length;
  record(
    "approvalTurn",
    await a.request("turn/start", {
      threadId,
      input: input("Synthetic approval request"),
      clientUserMessageId: "delivery_synthetic_approval",
      approvalPolicy: "on-request",
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-5.4", reasoning_effort: null, developer_instructions: null },
      },
    }),
  );
  const approval = await a.event("item/commandExecution/requestApproval", () => true, mark);
  record("desktop.nativeApproval", approval);
  const d = await connect(port, "approval_reconnect");
  record("approval_reconnect.resume", await d.request("thread/resume", { threadId }));
  record("approval_reconnect.request", await d.event("item/commandExecution/requestApproval"));
  mark = a.events.length;
  d.respond(approval.id, { decision: "decline" });
  await a.event("turn/completed", () => true, mark);
  record("readAfterApproval", await read(d, threadId));

  // Kill the harness after a fully admitted message and pending queue item.
  modes.push("hold");
  record(
    "beforeCrash.turnStart",
    await a.request("turn/start", {
      threadId,
      input: input("Synthetic lost response"),
      clientUserMessageId: "delivery_synthetic_crash",
    }),
  );
  for (let n = 0; !held.length && n < 100; n++) await delay(50);
  record(
    "beforeCrash.queueAdd",
    await a.request("thread/queue/add", {
      threadId,
      input: input("Synthetic crash queue"),
      clientUserMessageId: "delivery_synthetic_crash_queue",
    }),
  );
  record("beforeCrash.read", await read(a, threadId));
  await stopServer(child);
  for (const h of held.splice(0)) h.res.destroy();
  const restartedPort = await startServer();
  const r = await connect(restartedPort, "restart");
  record("restart.loaded", await r.request("thread/loaded/list", {}));
  record(
    "restart.list",
    await r.request("thread/list", {
      useStateDbOnly: true,
      modelProviders: [],
      sourceKinds: [],
      limit: 20,
    }),
  );
  record("restart.readBeforeResume", await read(r, threadId));
  record("restart.queueBeforeResume", await r.request("thread/queue/list", { threadId }));
  record("restart.resume", await r.request("thread/resume", { threadId }));
  record("restart.queueAfterResume", await r.request("thread/queue/list", { threadId }));
  record("restart.readAfterResume", await read(r, threadId));
  record(
    "restart.itemsPage",
    await r.request("thread/items/list", { threadId, limit: 5, sortDirection: "desc" }),
  );

  // A separate app-server process sharing disk must not be mistaken for the live owner.
  modes.push("hold");
  record(
    "owner.turnStart",
    await r.request("turn/start", {
      threadId,
      input: input("Synthetic owned turn"),
      clientUserMessageId: "delivery_synthetic_owner",
    }),
  );
  for (let n = 0; !held.length && n < 100; n++) await delay(50);
  const ownerServer = child;
  const outsiderPort = await startServer();
  const outsider = await connect(outsiderPort, "other_process");
  record("otherProcess.loaded", await outsider.request("thread/loaded/list", {}));
  record("otherProcess.readActiveOwner", await read(outsider, threadId));
  record("otherProcess.resumeActiveOwner", await outsider.request("thread/resume", { threadId }));
  modes.push("hold");
  record(
    "otherProcess.turnStartActiveOwner",
    await outsider.request("turn/start", {
      threadId,
      input: input("Synthetic competing process turn"),
      clientUserMessageId: "delivery_synthetic_other_process",
    }),
  );
  for (let n = 0; held.length < 2 && n < 100; n++) await delay(50);
  record("concurrentProcesses", {
    heldModelCalls: held.length,
    ownerAlive: ownerServer.exitCode === null,
    outsiderAlive: child.exitCode === null,
  });
  await stopServer(child);
  await stopServer(ownerServer);
  for (const h of held.splice(0)) h.res.destroy();
  modes.length = 0;

  // Acknowledgement is not a durable write barrier: kill immediately after response.
  for (let iteration = 0; iteration < 5; iteration++) {
    const admissionPort = await startServer();
    const ac = await connect(admissionPort, `admission_${iteration}`);
    const created = await ac.request("thread/start", { cwd: runtime, modelProvider: "probe" });
    const admissionThread = created.result.thread.id;
    await ac.request("turn/start", {
      threadId: admissionThread,
      input: input("Synthetic durable seed"),
      clientUserMessageId: `delivery_synthetic_seed_${iteration}`,
    });
    await ac.event("turn/completed");
    await idle(ac, admissionThread);
    const delivery = `delivery_synthetic_ack_crash_${iteration}`;
    modes.push("hold");
    const result = await ac.request("turn/start", {
      threadId: admissionThread,
      input: input("Synthetic immediate admission crash"),
      clientUserMessageId: delivery,
    });
    await stopServer(child);
    for (const h of held.splice(0)) h.res.destroy();
    modes.length = 0;
    const verifyPort = await startServer();
    const vc = await connect(verifyPort, `verify_admission_${iteration}`);
    const state = await read(vc, admissionThread);
    record("immediateAdmissionCrash", {
      iteration,
      acknowledgedTurnId: result.result?.turn.id,
      error: state.error,
      status: state.result?.thread.status,
      matchingItems: state.result?.thread.turns
        .flatMap((t) => t.items)
        .filter((i) => i.clientId === delivery),
    });
    await stopServer(child);
  }

  // A real terminal client starts the session against the shared app-server.
  await appendFile(
    join(codexHome, "config.toml"),
    `\n[projects.${JSON.stringify(runtime)}]\ntrust_level = "trusted"\n`,
  );
  const terminalPort = await startServer();
  const watcher = await connect(terminalPort, "terminal_watcher");
  modes.push("hold");
  const terminal = spawn(
    "/usr/bin/python3",
    [
      join(base, "pty-launch.py"),
      binary,
      "--remote",
      `ws://127.0.0.1:${terminalPort}`,
      "--no-alt-screen",
      "-m",
      "gpt-5.6-terra",
      "-C",
      runtime,
      "Synthetic terminal-origin task",
    ],
    {
      env: { ...env, TERM: "xterm-256color", COLUMNS: "120", LINES: "40" },
      cwd: runtime,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  terminals.push(terminal);
  let terminalLog = "";
  terminal.stdout.on("data", (data) => {
    terminalLog += data;
    if (data.includes(Buffer.from("\x1b[6n"))) terminal.stdin.write("\x1b[1;1R");
    if (data.includes(Buffer.from("\x1b[c"))) terminal.stdin.write("\x1b[?1;2c");
  });
  terminal.stderr.on("data", (data) => {
    terminalLog += data;
  });
  let terminalThread;
  for (let n = 0; n < 200; n++) {
    terminalThread = watcher.events.find((e) => e.method === "thread/started")?.params.thread;
    if (terminalThread || terminal.exitCode !== null) break;
    await delay(25);
  }
  record("terminal.start", {
    exitCode: terminal.exitCode,
    thread: terminalThread && {
      id: terminalThread.id,
      source: terminalThread.source,
      status: terminalThread.status,
    },
    diagnostic: terminalThread ? undefined : stripVTControlCharacters(terminalLog).slice(-3000),
  });
  if (terminalThread) {
    for (let n = 0; !held.length && n < 100; n++) await delay(25);
    record(
      "terminal.discovered",
      await watcher.request("thread/list", {
        useStateDbOnly: true,
        sourceKinds: [],
        modelProviders: [],
      }),
    );
    record("terminal.readActive", await read(watcher, terminalThread.id));
    record(
      "terminal.resumeActive",
      await watcher.request("thread/resume", { threadId: terminalThread.id }),
    );
    const terminalHeld = held.shift();
    if (terminalHeld) complete(terminalHeld.res, "text", terminalHeld.serial);
    record(
      "terminal.completed",
      await watcher.event("turn/completed", (e) => e.params.threadId === terminalThread.id),
    );
    record("terminal.readCompleted", await read(watcher, terminalThread.id));
    mark = watcher.events.length;
    const terminalOutputMark = terminalLog.length;
    record(
      "terminal.phoneFollowup",
      await watcher.request("turn/start", {
        threadId: terminalThread.id,
        input: input("REMOTE_FOLLOWUP_SYNTHETIC_DELIVERY"),
        clientUserMessageId: "delivery_synthetic_terminal_followup",
      }),
    );
    await watcher.event("turn/completed", () => true, mark);
    await delay(100);
    record("terminal.followupVisible", {
      sawUniqueInput: terminalLog
        .slice(terminalOutputMark)
        .includes("REMOTE_FOLLOWUP_SYNTHETIC_DELIVERY"),
    });
    record("terminal.readAfterFollowup", await read(watcher, terminalThread.id));
  }

  // The default TUI, without --remote or any per-session SHark tag.
  modes.push("hold");
  usedNativeDaemon = true;
  const native = spawn(
    "/usr/bin/python3",
    [
      join(base, "pty-launch.py"),
      binary,
      "--no-alt-screen",
      "-m",
      "gpt-5.6-terra",
      "-C",
      runtime,
      "SYNTHETIC_DEFAULT_TERMINAL_TASK",
    ],
    {
      env: { ...env, TERM: "xterm-256color" },
      cwd: runtime,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  terminals.push(native);
  let nativeLog = "";
  native.stdout.on("data", (data) => {
    nativeLog += data;
    if (data.includes(Buffer.from("\x1b[6n"))) native.stdin.write("\x1b[1;1R");
    if (data.includes(Buffer.from("\x1b[c"))) native.stdin.write("\x1b[?1;2c");
  });
  native.stderr.on("data", (data) => {
    nativeLog += data;
  });
  for (let n = 0; !held.length && native.exitCode === null && n < 200; n++) await delay(25);
  record("defaultTerminal.started", {
    exitCode: native.exitCode,
    heldModelCalls: held.length,
    diagnostic: held.length ? undefined : stripVTControlCharacters(nativeLog).slice(-3000),
  });
  const proxy = spawn(binary, ["app-server", "proxy"], {
    env,
    cwd: runtime,
    stdio: ["pipe", "pipe", "pipe"],
  });
  servers.push(proxy);
  const transport = {
    send(data) {
      proxy.stdin.write(`${data}\n`);
    },
    close() {
      proxy.kill("SIGTERM");
    },
  };
  let proxyBuffer = "";
  proxy.stdout.on("data", (data) => {
    proxyBuffer += data;
    while (true) {
      const newline = proxyBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = proxyBuffer.slice(0, newline);
      proxyBuffer = proxyBuffer.slice(newline + 1);
      if (line) transport.onmessage?.({ data: line });
    }
  });
  let proxyLog = "";
  proxy.stderr.on("data", (data) => {
    proxyLog += data;
  });
  await delay(250);
  record("defaultTerminal.proxy", { exitCode: proxy.exitCode, diagnostic: proxyLog });
  if (proxy.exitCode !== null) {
    const defaults = await watcher.request("thread/list", {
      useStateDbOnly: true,
      sourceKinds: [],
      modelProviders: [],
      limit: 20,
    });
    const unmanaged = defaults.result?.data.find(
      (t) => t.preview === "SYNTHETIC_DEFAULT_TERMINAL_TASK",
    );
    record("defaultTerminal.discoveredByOtherProcess", { threadId: unmanaged?.id });
    if (unmanaged) {
      record("defaultTerminal.otherProcessRead", await read(watcher, unmanaged.id));
      record(
        "defaultTerminal.otherProcessResume",
        await watcher.request("thread/resume", { threadId: unmanaged.id }),
      );
      const h = held.shift();
      if (h) complete(h.res, "text", h.serial);
      await delay(250);
      record("defaultTerminal.completedDiskRead", await read(watcher, unmanaged.id));
    }
  } else {
    const nativeObserver = await connect(null, "default_terminal_proxy", transport);
    record("defaultTerminal.loaded", await nativeObserver.request("thread/loaded/list", {}));
    const nativeList = await nativeObserver.request("thread/list", {
      useStateDbOnly: true,
      sourceKinds: [],
      modelProviders: [],
      limit: 20,
    });
    record("defaultTerminal.list", nativeList);
    const nativeThread = nativeList.result?.data.find(
      (t) => t.preview === "SYNTHETIC_DEFAULT_TERMINAL_TASK",
    );
    if (nativeThread) {
      record("defaultTerminal.readActive", await read(nativeObserver, nativeThread.id));
      record(
        "defaultTerminal.resumeActive",
        await nativeObserver.request("thread/resume", { threadId: nativeThread.id }),
      );
      const h = held.shift();
      if (h) complete(h.res, "text", h.serial);
      record(
        "defaultTerminal.completed",
        await nativeObserver.event("turn/completed", (e) => e.params.threadId === nativeThread.id),
      );
      const nativeMark = nativeObserver.events.length;
      const nativeTextMark = nativeLog.length;
      record(
        "defaultTerminal.followup",
        await nativeObserver.request("turn/start", {
          threadId: nativeThread.id,
          input: input("DEFAULT_TERMINAL_REMOTE_FOLLOWUP"),
          clientUserMessageId: "delivery_synthetic_default_terminal",
        }),
      );
      await nativeObserver.event("turn/completed", () => true, nativeMark);
      await delay(100);
      record("defaultTerminal.followupVisible", {
        sawUniqueInput: nativeLog
          .slice(nativeTextMark)
          .includes("DEFAULT_TERMINAL_REMOTE_FOLLOWUP"),
      });
      record("defaultTerminal.readCompleted", await read(nativeObserver, nativeThread.id));
    }
  }
} catch (error) {
  record("failure", { message: String(error), log: childLog.replaceAll(runtime, "<RUNTIME>") });
  process.exitCode = 1;
} finally {
  for (const c of clients) c.ws.close();
  for (const terminal of terminals) {
    try {
      process.kill(-terminal.pid, "SIGTERM");
    } catch {}
  }
  for (const server of servers) await stopServer(server);
  for (const socket of sockets) socket.destroy();
  model.close();
  if (usedNativeDaemon) {
    // CODEX_HOME is the fresh temporary directory, never the user's real daemon.
    const stop = spawn(binary, ["app-server", "daemon", "stop"], {
      env,
      cwd: runtime,
      stdio: "ignore",
    });
    const timer = setTimeout(() => stop.kill("SIGKILL"), 5000);
    await new Promise((resolve) => stop.once("exit", resolve));
    clearTimeout(timer);
    record("syntheticDaemonStopped", { exitCode: stop.exitCode, signal: stop.signalCode });
  }
  const rawText = `${JSON.stringify(evidence, null, 2).replaceAll(`/private${runtime}`, "<RUNTIME>").replaceAll(runtime, "<RUNTIME>")}\n`;
  const rawEvidenceFile = join(runtime, "full-evidence.json");
  await writeFile(rawEvidenceFile, rawText);
  const summary = summarizeEvidence(JSON.parse(rawText), rawText, rawEvidenceFile);
  await writeFile(join(base, "evidence.json"), `${JSON.stringify(summary, null, 2)}\n`);
}
