import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_API_URL = "https://shark.shuv.dev";
const DEFAULT_SCOPES = [
  "notifications:send",
  "interactions:create",
  "interactions:read",
  "activities:read",
  "activities:write",
  "devices:read",
  "services:read",
  "services:write",
];
const TERMINAL = new Set(["approved", "denied", "yes", "no", "replied", "canceled", "expired"]);

export class UsageError extends Error {}
export class RequestError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function parseDuration(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);
  if (!match) throw new UsageError(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const multiplier =
    match[2] === "d" ? 86_400 : match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1;
  return Math.round(amount * multiplier);
}

function parseAccentColor(value) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(value))) {
    throw new UsageError("--accent-color must use #RRGGBB format");
  }
  return String(value);
}

const ACTIVITY_STYLES = ["standard", "ring", "hero", "terminal", "steps"];

function parseStyle(value) {
  if (!ACTIVITY_STYLES.includes(String(value))) {
    throw new UsageError(`--style must be one of: ${ACTIVITY_STYLES.join(", ")}`);
  }
  return String(value);
}

export function parseArgs(argv) {
  const positionals = [];
  const options = { device: [], scope: [] };
  /** Index in `positionals` where post-`--` arguments start, or null. */
  let separatorAt = null;
  const valueFlags = new Set([
    "title",
    "image",
    "url",
    "device",
    "expires-in",
    "idempotency-key",
    "timeout",
    "client-name",
    "scope",
    "key",
    "status",
    "detail",
    "progress",
    "symbol",
    "privacy",
    "accent-color",
    "style",
    "stale-after",
    "dismiss-after",
    "if-sequence",
    "limit",
  ]);
  const booleanFlags = new Set([
    "approval",
    "yes-no",
    "text",
    "wait",
    "poll",
    "replace",
    "json",
    "stdin",
    "help",
    "open",
    "no-open",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (separatorAt === null && argument === "--") {
      separatorAt = positionals.length;
      continue;
    }
    if (separatorAt !== null || !argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const [rawName, inline] = argument.slice(2).split("=", 2);
    if (valueFlags.has(rawName)) {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith("--")) throw new UsageError(`--${rawName} requires a value`);
      if (rawName === "device" || rawName === "scope") options[rawName].push(value);
      else options[rawName] = value;
    } else if (booleanFlags.has(rawName) && inline === undefined) {
      options[rawName] = true;
    } else {
      throw new UsageError(`Unknown option: --${rawName}`);
    }
  }
  return { positionals, options, separatorAt };
}

export function configPath(env = process.env) {
  if (env.HARK_CONFIG) return env.HARK_CONFIG;
  if (platform() === "win32") return join(env.APPDATA ?? homedir(), "hark", "config.json");
  if (platform() === "darwin")
    return join(homedir(), "Library", "Application Support", "hark", "config.json");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "hark", "config.json");
}

export async function loadConfig(env = process.env) {
  if (env.HARK_TOKEN) {
    return {
      token: env.HARK_TOKEN,
      apiUrl: env.HARK_API_URL ?? DEFAULT_API_URL,
      source: "environment",
    };
  }
  const path = configPath(env);
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new RequestError(
        `No token configured. Run harkctl auth login, set HARK_TOKEN, or create ${path}.`,
        401,
      );
    }
    throw error;
  }
  if (platform() !== "win32" && (info.mode & 0o077) !== 0) {
    throw new RequestError(
      `Refusing insecure config permissions for ${path}; expected mode 0600.`,
      401,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new RequestError(`Invalid JSON in ${path}.`, 401);
  }
  if (typeof parsed.token !== "string" || !parsed.token.startsWith("hark_")) {
    throw new RequestError(`Missing SHark token in ${path}.`, 401);
  }
  return {
    token: parsed.token,
    apiUrl: env.HARK_API_URL ?? parsed.apiUrl ?? DEFAULT_API_URL,
    tokenId: typeof parsed.tokenId === "string" ? parsed.tokenId : undefined,
    source: "file",
    path,
  };
}

export async function writeConfig(path, config) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(
    directory,
    `.config.json.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (platform() !== "win32") await chmod(temporary, 0o600);
    await rename(temporary, path);
    if (platform() !== "win32") await chmod(path, 0o600);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function openBrowser(url) {
  const target = String(url);
  const command =
    platform() === "darwin"
      ? { file: "open", args: [target] }
      : platform() === "win32"
        ? { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", target] }
        : { file: "xdg-open", args: [target] };
  const child = spawn(command.file, command.args, {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
}

async function request(config, path, init = {}) {
  let response;
  try {
    response = await fetch(`${String(config.apiUrl).replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    throw new RequestError(error instanceof Error ? error.message : "Network request failed", 0);
  }
  const body = await response
    .json()
    .catch(() => ({ error: `Request failed (${response.status})` }));
  if (!response.ok) throw new RequestError(body.error ?? "Request failed", response.status, body);
  return body;
}

async function publicRequest(apiUrl, path, init = {}) {
  let response;
  try {
    response = await fetch(`${String(apiUrl).replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch (error) {
    throw new RequestError(error instanceof Error ? error.message : "Network request failed", 0);
  }
  const body = await response
    .json()
    .catch(() => ({ error: `Request failed (${response.status})` }));
  if (!response.ok) throw new RequestError(body.error ?? "Request failed", response.status, body);
  return body;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function login(options, env, runtime) {
  if (options.open && options["no-open"]) {
    throw new UsageError("--open and --no-open cannot be used together");
  }
  const apiUrl = env.HARK_API_URL ?? DEFAULT_API_URL;
  const expiresInSeconds = parseDuration(options["expires-in"] ?? "90d");
  const timeoutSeconds = parseDuration(options.timeout ?? "10m");
  const clientName = options["client-name"] ?? "harkctl";
  const scopes = options.scope.length > 0 ? [...new Set(options.scope)] : DEFAULT_SCOPES;
  const started = await publicRequest(apiUrl, "/api/device-authorization/start", {
    method: "POST",
    body: JSON.stringify({ clientName, scopes, expiresInSeconds }),
  });

  runtime.stderr(`Code: ${started.userCode}`);
  runtime.stderr(`Authorize at: ${started.verificationUri}`);
  const shouldOpen = options.open || (!options["no-open"] && runtime.stderrIsTTY);
  if (shouldOpen) {
    try {
      runtime.openBrowser(started.verificationUriComplete);
    } catch (error) {
      runtime.stderr(
        `Could not open browser: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  const deadline = runtime.now() + Math.min(timeoutSeconds, started.expiresIn) * 1000;
  let interval = started.interval;
  while (runtime.now() < deadline) {
    await runtime.sleep(Math.min(interval * 1000, deadline - runtime.now()));
    if (runtime.now() >= deadline) break;
    let response;
    try {
      response = await publicRequest(apiUrl, "/api/device-authorization/token", {
        method: "POST",
        body: JSON.stringify({ deviceCode: started.deviceCode }),
      });
    } catch (error) {
      if (
        error instanceof RequestError &&
        ["authorization_pending", "slow_down"].includes(error.body?.error)
      ) {
        interval =
          Number(error.body?.interval) ||
          (error.body?.error === "slow_down" ? interval + 5 : interval);
        continue;
      }
      throw error;
    }

    const path = configPath(env);
    try {
      await runtime.writeConfig(path, {
        apiUrl,
        token: response.accessToken,
        tokenId: response.token.id,
      });
    } catch (error) {
      await request({ apiUrl, token: response.accessToken }, "/api/agent/auth/revoke", {
        method: "POST",
      }).catch(() => {});
      throw error;
    }
    return {
      authenticated: true,
      token: response.token,
      configPath: path,
    };
  }
  throw new RequestError("Authorization timed out", 408, { error: "expired_token" });
}

async function readStdinJson() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try {
    return JSON.parse(input);
  } catch {
    throw new UsageError("stdin must contain valid JSON");
  }
}

function interactionExitCode(interaction) {
  if (interaction.status === "denied" || interaction.status === "no") return 5;
  if (interaction.status === "canceled" || interaction.status === "expired") return 4;
  return 0;
}

/** `--poll` waits this long at most for an instant answer before returning. */
const POLL_TIMEOUT_SECONDS = 20;

async function waitForInteraction(config, id, timeoutSeconds, runtime) {
  const now = runtime?.now ?? (() => Date.now());
  const deadline = now() + timeoutSeconds * 1000;
  let body;
  while (true) {
    const remaining = Math.max(0, (deadline - now()) / 1000);
    body = await request(
      config,
      `/api/agent/interactions/${encodeURIComponent(id)}/wait?timeout=${Math.min(25, remaining)}`,
    );
    if (TERMINAL.has(body.interaction.status)) return body;
    if (now() >= deadline) return { ...body, timedOut: true };
  }
}

function help() {
  return `Usage:
  harkctl auth login [--client-name <name>] [--scope <scope>] [--expires-in <duration>]
                     [--timeout <duration>] [--open|--no-open] [--json]
  harkctl auth logout
  harkctl auth status
  harkctl notify <body> [--title <name>] [--image <url>] [--url <url>] [--device <id>]
                 [--idempotency-key <key>] [--stdin]
  harkctl notify ask <prompt> (--approval|--yes-no|--text) [--title <name>] [--image <url>]
                 [--url <url>] [--device <id>] [--expires-in <duration>]
                 [--idempotency-key <key>] [--stdin] [--wait [--timeout <duration>] | --poll]
  harkctl interaction get <id>
  harkctl interaction wait <id> [--timeout <duration>]
  harkctl activity start --title <title> --status <status> [--progress <0..1>] [--key <key>]
                         [--style <standard|ring|hero|terminal|steps>]
                         [--accent-color <#RRGGBB>] [--replace]
  harkctl activity update <id|key> [--status <status>] [--detail <text>] [--progress <0..1>]
                            [--style <standard|ring|hero|terminal|steps>]
                            [--if-sequence <n>] [--idempotency-key <key>]
  harkctl activity end <id|key> [--status <status>] [--dismiss-after <duration>]
                         [--if-sequence <n>] [--idempotency-key <key>]
  harkctl activity get <id|key>
  harkctl activity list [--limit <n>]
  harkctl devices list
  harkctl services list
  harkctl services create --title <title> [--image <url>] [--url <url>] [--stdin]

notify sends a one-shot push; notify ask sends a push that elicits an answer.
Inside notify, a first positional of exactly "ask" selects the subcommand. Everything
after a bare "--" is treated as positional, so "harkctl notify -- ask" sends the
literal body "ask". --wait blocks until the answer or timeout; --poll waits at most
${POLL_TIMEOUT_SECONDS} seconds to catch an instant answer. A timed-out poll or wait does
not end the prompt: it stays answerable on the phone until it expires, and
harkctl interaction wait <id> resumes waiting at any time.

Authentication: run harkctl auth login, or set HARK_TOKEN for an advanced manual setup.
Tokens are never accepted as command arguments.`;
}

export async function execute(argv, env = process.env, overrides = {}) {
  const { positionals, options, separatorAt } = parseArgs(argv);
  if (options.help || positionals.length === 0)
    return { body: { help: help() }, exitCode: 0, text: true };
  const [group, action, id] = positionals;
  const runtime = {
    now: () => Date.now(),
    openBrowser,
    sleep,
    stderr: (message) => console.error(message),
    stderrIsTTY: Boolean(process.stderr.isTTY),
    writeConfig,
    ...overrides,
  };

  if (group === "auth" && action === "login") {
    return { body: await login(options, env, runtime), exitCode: 0 };
  }

  const config = await loadConfig(env);

  if (group === "auth" && action === "logout") {
    let revoked = false;
    try {
      await request(config, "/api/agent/auth/revoke", { method: "POST" });
      revoked = true;
    } catch {
      // Local credentials are removed even if the server is unreachable or already revoked.
    }
    if (config.source === "file") await rm(config.path, { force: true });
    return {
      body: {
        authenticated: false,
        revoked,
        credentialsRemoved: config.source === "file",
      },
      exitCode: 0,
    };
  }

  if (group === "auth" && action === "status") {
    return { body: await request(config, "/api/agent/auth/status"), exitCode: 0 };
  }
  if (group === "devices" && action === "list") {
    return { body: await request(config, "/api/agent/devices"), exitCode: 0 };
  }
  if (group === "services" && action === "list") {
    return { body: await request(config, "/api/agent/services"), exitCode: 0 };
  }
  if (group === "services" && action === "create") {
    const stdin = options.stdin ? await readStdinJson() : {};
    const title = options.title ?? stdin.title;
    if (!title) throw new UsageError("services create requires --title");
    const payload = {
      ...stdin,
      title,
      ...(options.image ? { imageUrl: options.image } : {}),
      ...(options.url ? { url: options.url } : {}),
    };
    return {
      body: await request(config, "/api/agent/services", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      exitCode: 0,
    };
  }
  if (group === "activity" && action === "list") {
    const limit = options.limit ? Number.parseInt(options.limit, 10) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new UsageError("--limit must be an integer from 1 to 100");
    }
    return {
      body: await request(config, `/api/agent/activities?limit=${limit}`),
      exitCode: 0,
    };
  }
  if (group === "activity" && action === "get") {
    const identifier = id ?? options.key;
    if (!identifier) throw new UsageError("activity get requires an activity ID or --key");
    return {
      body: await request(config, `/api/agent/activities/${encodeURIComponent(identifier)}`),
      exitCode: 0,
    };
  }
  if (group === "activity" && action === "start") {
    const stdin = options.stdin ? await readStdinJson() : {};
    const progress = options.progress === undefined ? stdin.progress : Number(options.progress);
    if (progress !== undefined && (!Number.isFinite(progress) || progress < 0 || progress > 1)) {
      throw new UsageError("--progress must be a number from 0 to 1");
    }
    const title = options.title ?? stdin.title;
    const status = options.status ?? stdin.status;
    if (!title || !status) throw new UsageError("activity start requires --title and --status");
    const payload = {
      ...stdin,
      title,
      status,
      ...(options.key ? { key: options.key } : {}),
      ...(options.replace ? { replace: true } : {}),
      ...(options.detail ? { detail: options.detail } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(options.symbol ? { symbol: options.symbol } : {}),
      ...(options.privacy ? { privacyMode: options.privacy } : {}),
      ...(options["accent-color"]
        ? { accentColor: parseAccentColor(options["accent-color"]) }
        : {}),
      ...(options.style ? { style: parseStyle(options.style) } : {}),
      ...(options.device.length > 0 ? { deviceIds: options.device } : {}),
      ...(options["expires-in"] ? { expiresInSeconds: parseDuration(options["expires-in"]) } : {}),
      ...(options["stale-after"]
        ? { staleAfterSeconds: parseDuration(options["stale-after"]) }
        : {}),
    };
    const body = await request(config, "/api/agent/activities", {
      method: "POST",
      headers: options["idempotency-key"]
        ? { "Idempotency-Key": options["idempotency-key"] }
        : undefined,
      body: JSON.stringify(payload),
    });
    return { body, exitCode: body.accepted === 0 ? 7 : 0 };
  }
  if (group === "activity" && action === "update") {
    const identifier = id ?? options.key;
    if (!identifier) throw new UsageError("activity update requires an activity ID or --key");
    const stdin = options.stdin ? await readStdinJson() : {};
    const progress = options.progress === undefined ? stdin.progress : Number(options.progress);
    if (
      progress !== undefined &&
      progress !== null &&
      (!Number.isFinite(progress) || progress < 0 || progress > 1)
    ) {
      throw new UsageError("--progress must be a number from 0 to 1");
    }
    const ifSequence =
      options["if-sequence"] === undefined
        ? stdin.ifSequence
        : Number.parseInt(options["if-sequence"], 10);
    if (ifSequence !== undefined && (!Number.isInteger(ifSequence) || ifSequence < 0)) {
      throw new UsageError("--if-sequence must be a non-negative integer");
    }
    const payload = {
      ...stdin,
      ...(options.title ? { title: options.title } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.detail ? { detail: options.detail } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(options.symbol ? { symbol: options.symbol } : {}),
      ...(options.privacy ? { privacyMode: options.privacy } : {}),
      ...(options["accent-color"]
        ? { accentColor: parseAccentColor(options["accent-color"]) }
        : {}),
      ...(options.style ? { style: parseStyle(options.style) } : {}),
      ...(options["stale-after"]
        ? { staleAfterSeconds: parseDuration(options["stale-after"]) }
        : {}),
      ...(ifSequence !== undefined ? { ifSequence } : {}),
    };
    const body = await request(config, `/api/agent/activities/${encodeURIComponent(identifier)}`, {
      method: "PATCH",
      headers: options["idempotency-key"]
        ? { "Idempotency-Key": options["idempotency-key"] }
        : undefined,
      body: JSON.stringify(payload),
    });
    return { body, exitCode: body.accepted === 0 ? 7 : 0 };
  }
  if (group === "activity" && action === "end") {
    const identifier = id ?? options.key;
    if (!identifier) throw new UsageError("activity end requires an activity ID or --key");
    const stdin = options.stdin ? await readStdinJson() : {};
    const ifSequence =
      options["if-sequence"] === undefined
        ? stdin.ifSequence
        : Number.parseInt(options["if-sequence"], 10);
    if (ifSequence !== undefined && (!Number.isInteger(ifSequence) || ifSequence < 0)) {
      throw new UsageError("--if-sequence must be a non-negative integer");
    }
    const payload = {
      ...stdin,
      ...(options.status ? { status: options.status } : {}),
      ...(options.detail ? { detail: options.detail } : {}),
      ...(options.progress !== undefined ? { progress: Number(options.progress) } : {}),
      ...(options.symbol ? { symbol: options.symbol } : {}),
      ...(options["accent-color"]
        ? { accentColor: parseAccentColor(options["accent-color"]) }
        : {}),
      ...(options["dismiss-after"]
        ? { dismissAfterSeconds: parseDuration(options["dismiss-after"]) }
        : {}),
      ...(ifSequence !== undefined ? { ifSequence } : {}),
    };
    const body = await request(
      config,
      `/api/agent/activities/${encodeURIComponent(identifier)}/end`,
      {
        method: "POST",
        headers: options["idempotency-key"]
          ? { "Idempotency-Key": options["idempotency-key"] }
          : undefined,
        body: JSON.stringify(payload),
      },
    );
    return { body, exitCode: body.accepted === 0 ? 7 : 0 };
  }
  if (group === "interaction" && action === "get" && id) {
    const body = await request(config, `/api/agent/interactions/${encodeURIComponent(id)}`);
    return { body, exitCode: interactionExitCode(body.interaction) };
  }
  if (group === "interaction" && action === "wait" && id) {
    const timeout = parseDuration(options.timeout ?? "60s");
    const body = await waitForInteraction(config, id, timeout, runtime);
    return {
      body,
      exitCode: body.timedOut ? 4 : interactionExitCode(body.interaction),
    };
  }
  if (group === "notify") {
    // A first positional of exactly `ask` selects the subcommand unless it came
    // after a bare `--`, which forces it to be the literal notification body.
    const isAsk = positionals[1] === "ask" && (separatorAt === null || separatorAt > 1);
    if (isAsk) {
      const selectors = [
        options.approval ? "approval" : null,
        options["yes-no"] ? "yes_no" : null,
        options.text ? "reply" : null,
      ].filter(Boolean);
      if (selectors.length !== 1) {
        throw new UsageError(
          "notify ask requires exactly one response type: --approval, --yes-no, or --text",
        );
      }
      if (options.poll && (options.wait || options.timeout !== undefined)) {
        throw new UsageError("--poll cannot be combined with --wait or --timeout");
      }
      if (options.timeout !== undefined && !options.wait) {
        throw new UsageError("--timeout requires --wait");
      }
      const stdin = options.stdin ? await readStdinJson() : {};
      const prompt = positionals.slice(2).join(" ") || stdin.prompt;
      if (!prompt) throw new UsageError("notify ask requires a prompt");
      const expiresInSeconds = parseDuration(options["expires-in"] ?? stdin.expiresIn ?? "15m");
      const payload = {
        ...stdin,
        title: options.title ?? stdin.title ?? "SHark",
        prompt,
        kind: selectors[0],
        expiresInSeconds,
        ...(options.image ? { imageUrl: options.image } : {}),
        ...(options.url ? { url: options.url } : {}),
        ...(options.device.length > 0 ? { deviceIds: options.device } : {}),
      };
      const body = await request(config, "/api/agent/interactions", {
        method: "POST",
        headers: options["idempotency-key"]
          ? { "Idempotency-Key": options["idempotency-key"] }
          : undefined,
        body: JSON.stringify(payload),
      });
      if (body.accepted === 0) return { body, exitCode: 7 };
      if (!options.wait && !options.poll) return { body, exitCode: 0 };
      const timeout = options.poll
        ? POLL_TIMEOUT_SECONDS
        : parseDuration(options.timeout ?? `${expiresInSeconds}s`);
      const waited = await waitForInteraction(config, body.interaction.id, timeout, runtime);
      return {
        body: { ...body, interaction: waited.interaction, timedOut: waited.timedOut ?? false },
        exitCode: waited.timedOut ? 4 : interactionExitCode(waited.interaction),
      };
    }
    const stdin = options.stdin ? await readStdinJson() : {};
    const notificationBody = positionals.slice(1).join(" ") || stdin.body;
    if (!notificationBody) throw new UsageError("notify requires a message body");
    const payload = {
      ...stdin,
      body: notificationBody,
      ...(options.title ? { title: options.title } : {}),
      ...(options.image ? { imageUrl: options.image } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.device.length > 0 ? { deviceIds: options.device } : {}),
    };
    const body = await request(config, "/api/agent/notifications", {
      method: "POST",
      headers: options["idempotency-key"]
        ? { "Idempotency-Key": options["idempotency-key"] }
        : undefined,
      body: JSON.stringify(payload),
    });
    return { body, exitCode: body.accepted === 0 ? 7 : 0 };
  }
  throw new UsageError("Unknown command. Run harkctl --help.");
}

export async function run(argv, env = process.env, overrides = {}) {
  try {
    const result = await execute(argv, env, overrides);
    if (result.text) console.log(result.body.help);
    else console.log(JSON.stringify(result.body));
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error(message);
    if (error instanceof UsageError) return 2;
    if (error instanceof RequestError) {
      if (error.body?.error === "access_denied") return 5;
      if (error.status === 408 || error.body?.error === "expired_token") return 4;
      if (error.status === 401 || error.status === 403) return 3;
      if (error.status === 0) return 6;
    }
    return 1;
  }
}
