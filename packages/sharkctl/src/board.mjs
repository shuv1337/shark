import { readFile } from "node:fs/promises";
import { scopedRequest } from "./client.mjs";

/**
 * `sharkctl board …`: durable asks, work items, and notes for the captain's
 * board. Every verb writes only this token's rows; nothing here can answer.
 * Exit codes follow the CLI contract: 0 ok or answered, 4 expired, cancelled,
 * or timed out, 2 usage, 3 auth or scope, 1 other API failure.
 */

export class BoardUsageError extends Error {}

const BOARD_KINDS = new Set(["decision", "approval", "merge", "connect", "todo"]);
const BOARD_PRIORITIES = new Set(["p0", "p1", "p2"]);
const WORK_STATES = new Set(["queued", "in_flight", "review", "blocked"]);
const DONE_VERBS = new Set(["merged", "shipped", "done", "closed", "reported"]);
const DONE_OUTCOMES = new Set(["done", "failed", "cancelled"]);
const LINK_KINDS = new Set(["pr", "issue", "linear", "source", "doc", "other"]);

/** Mirrors the server's screen so an accidental paste never leaves the host. */
const SECRET_PATTERNS = [
  ["SHark API token", /\bhark_[A-Za-z0-9_-]{40,}/],
  ["SHark webhook URL", /\/hooks\/whk_[A-Za-z0-9_-]{10,}/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ["OpenAI-style key", /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/],
  ["Slack token", /\bxox[abpres]-[A-Za-z0-9-]{10,}/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{32,}=*/i],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

export function findBoardSecret(text) {
  if (!text) return null;
  for (const [name, pattern] of SECRET_PATTERNS) {
    if (pattern.test(String(text))) return name;
  }
  return null;
}

function screen(values) {
  for (const value of values) {
    const hit = findBoardSecret(value);
    if (hit) {
      throw new BoardUsageError(
        `Refusing to send board content that looks like a ${hit}; link to it instead`,
      );
    }
  }
}

function slug(label, taken) {
  let base = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (!base) base = "option";
  let id = base;
  let counter = 2;
  while (taken.has(id)) id = `${base}-${counter++}`;
  taken.add(id);
  return id;
}

/** `--option Label`, `--option id=Label`, or `--option id=Label:primary|destructive`. */
export function parseOptions(values) {
  const taken = new Set();
  return values.map((raw) => {
    let id;
    let label = raw;
    let style = "neutral";
    const styleMatch = label.match(/:(primary|neutral|destructive)$/);
    if (styleMatch) {
      style = styleMatch[1];
      label = label.slice(0, -styleMatch[0].length);
    }
    const idMatch = label.match(/^([A-Za-z0-9_-]{1,40})=(.+)$/);
    if (idMatch) {
      id = idMatch[1];
      label = idMatch[2];
      if (taken.has(id)) throw new BoardUsageError(`Duplicate option id ${id}`);
      taken.add(id);
    } else {
      id = slug(label, taken);
    }
    if (!label.trim()) throw new BoardUsageError("Option labels cannot be empty");
    return { id, label: label.trim(), style };
  });
}

/** `--link URL` or `--link kind=URL`. */
export function parseLinks(values) {
  return values.map((raw) => {
    const match = raw.match(/^([a-z]+)=(https?:\/\/.+)$/);
    if (match) {
      if (!LINK_KINDS.has(match[1])) {
        throw new BoardUsageError(
          `Unknown link kind ${match[1]}; use ${[...LINK_KINDS].join(", ")}`,
        );
      }
      return { kind: match[1], url: match[2] };
    }
    if (!/^https:\/\//.test(raw)) throw new BoardUsageError(`Links must be HTTPS URLs: ${raw}`);
    return { kind: "other", url: raw };
  });
}

async function fileText(path) {
  if (path === "-") return null;
  return (await readFile(path, "utf8")).trim();
}

export function boardExitCode(ask) {
  if (!ask) return 1;
  if (ask.status === "expired" || ask.status === "cancelled") return 4;
  return 0;
}

async function waitForAsk(config, key, timeoutSeconds, runtime) {
  const now = runtime?.now ?? (() => Date.now());
  const deadline = now() + timeoutSeconds * 1000;
  let body;
  while (true) {
    const remaining = Math.max(0, (deadline - now()) / 1000);
    body = await scopedRequest(
      config,
      `/api/agent/board/asks/${encodeURIComponent(key)}/wait?timeout=${Math.min(25, Math.round(remaining * 10) / 10)}`,
    );
    if (body.ask.status !== "open") return { ...body, timedOut: false };
    if (now() >= deadline) return { ...body, timedOut: true };
  }
}

function requireValue(options, name, verb) {
  if (!options[name]) throw new BoardUsageError(`board ${verb} requires --${name}`);
  return options[name];
}

/**
 * Runs one `board` verb. `context` supplies the loaded config, the runtime
 * (clock, stdin), `readStdinJson`, and `parseDuration` from the CLI.
 */
export async function boardCommand(action, positionals, options, context) {
  const { config, runtime, readStdinJson, parseDuration, env } = context;
  const stdin = options.stdin ? await readStdinJson(runtime) : {};

  if (action === "ask") {
    const key = options.key ?? stdin.key;
    const title = options.title ?? stdin.title;
    if (!key || !title) throw new BoardUsageError("board ask requires --key and --title");
    const bodyText =
      options["body-file"] !== undefined ? await fileText(options["body-file"]) : stdin.body;
    const kind = options.kind ?? stdin.kind;
    if (kind !== undefined && !BOARD_KINDS.has(kind)) {
      throw new BoardUsageError(`--kind must be one of ${[...BOARD_KINDS].join(", ")}`);
    }
    const priority = options.priority ?? stdin.priority;
    if (priority !== undefined && !BOARD_PRIORITIES.has(priority)) {
      throw new BoardUsageError("--priority must be p0, p1, or p2");
    }
    if (options.push !== undefined && options.push !== "auto" && options.push !== "none") {
      throw new BoardUsageError("--push must be auto or none");
    }
    const callbackUrlEnv = options["callback-url-env"];
    const callbackTokenFile = options["callback-token-file"];
    if ((callbackUrlEnv === undefined) !== (callbackTokenFile === undefined)) {
      throw new BoardUsageError("--callback-url-env and --callback-token-file go together");
    }
    let callback = stdin.callback;
    if (callbackUrlEnv !== undefined) {
      const url = env[callbackUrlEnv];
      if (!url) throw new BoardUsageError(`Environment variable ${callbackUrlEnv} is not set`);
      const token = await fileText(callbackTokenFile);
      if (!token) throw new BoardUsageError("The callback token file is empty");
      callback = { url, token };
    }
    const payload = {
      ...stdin,
      key,
      title,
      ...(bodyText ? { body: bodyText } : {}),
      ...(kind ? { kind } : {}),
      ...(options.option.length > 0 ? { options: parseOptions(options.option) } : {}),
      ...(options["allow-text"] ? { allowText: true } : {}),
      ...(options["no-later"] ? { allowLater: false } : {}),
      ...(priority ? { priority } : {}),
      ...(options.task ? { taskId: options.task } : {}),
      ...(options.agent ? { agentDisplay: options.agent } : {}),
      ...(options.link.length > 0 ? { links: parseLinks(options.link) } : {}),
      ...(options["expires-in"] ? { expiresInSeconds: parseDuration(options["expires-in"]) } : {}),
      ...(options.push ? { push: options.push } : {}),
      ...(callback ? { callback } : {}),
    };
    screen([
      payload.title,
      payload.body,
      payload.taskId,
      payload.agentDisplay,
      ...(payload.options ?? []).map((option) => option.label),
    ]);
    const body = await scopedRequest(config, "/api/agent/board/asks", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!options.wait) return { body, exitCode: 0 };
    const waited = await waitForAsk(config, key, parseDuration(options.timeout ?? "60s"), runtime);
    return {
      body: { ...body, ask: waited.ask, timedOut: waited.timedOut },
      exitCode: waited.timedOut ? 4 : boardExitCode(waited.ask),
    };
  }

  if (action === "cancel") {
    const key = requireValue(options, "key", "cancel");
    const body = await scopedRequest(
      config,
      `/api/agent/board/asks/${encodeURIComponent(key)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify(options.reason ? { reason: options.reason } : {}),
      },
    );
    return { body, exitCode: 0 };
  }

  if (action === "get") {
    const key = requireValue(options, "key", "get");
    const body = await scopedRequest(config, `/api/agent/board/asks/${encodeURIComponent(key)}`);
    return { body, exitCode: boardExitCode(body.ask) };
  }

  if (action === "wait") {
    const key = requireValue(options, "key", "wait");
    const body = await waitForAsk(config, key, parseDuration(options.timeout ?? "60s"), runtime);
    return { body, exitCode: body.timedOut ? 4 : boardExitCode(body.ask) };
  }

  if (action === "answers") {
    const params = new URLSearchParams();
    if (options.since) params.set("since", options.since);
    if (options.limit) params.set("limit", options.limit);
    const query = params.toString();
    const body = await scopedRequest(config, `/api/agent/board/answers${query ? `?${query}` : ""}`);
    return { body, exitCode: 0 };
  }

  if (action === "ack") {
    const key = requireValue(options, "key", "ack");
    const body = await scopedRequest(
      config,
      `/api/agent/board/asks/${encodeURIComponent(key)}/ack`,
      {
        method: "POST",
      },
    );
    return { body, exitCode: 0 };
  }

  if (action === "work") {
    const key = options.key ?? stdin.key;
    const title = options.title ?? stdin.title;
    const state = options.state ?? stdin.state;
    if (!key || !title || !state) {
      throw new BoardUsageError("board work requires --key, --title, and --state");
    }
    if (!WORK_STATES.has(state)) {
      throw new BoardUsageError(`--state must be one of ${[...WORK_STATES].join(", ")}`);
    }
    const progress = options.progress === undefined ? stdin.progress : Number(options.progress);
    if (
      progress !== undefined &&
      progress !== null &&
      (!Number.isFinite(progress) || progress < 0 || progress > 1)
    ) {
      throw new BoardUsageError("--progress must be a number from 0 to 1");
    }
    const payload = {
      ...stdin,
      key,
      title,
      state,
      ...(options.status ? { statusLabel: options.status } : {}),
      ...(options.detail ? { detail: options.detail } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(options.host ? { host: options.host } : {}),
      ...(options.agent ? { agentDisplay: options.agent } : {}),
      ...(options.link.length > 0 ? { links: parseLinks(options.link) } : {}),
      ...(options["waiting-ask"] ? { waitingAskKey: options["waiting-ask"] } : {}),
      ...(options["heartbeat-ttl"]
        ? { heartbeatTtlSeconds: parseDuration(options["heartbeat-ttl"]) }
        : {}),
    };
    screen([
      payload.title,
      payload.detail,
      payload.statusLabel,
      payload.host,
      payload.agentDisplay,
    ]);
    const body = await scopedRequest(config, "/api/agent/board/work", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    return { body, exitCode: 0 };
  }

  if (action === "done") {
    const key = requireValue(options, "key", "done");
    if (options.verb !== undefined && !DONE_VERBS.has(options.verb)) {
      throw new BoardUsageError(`--verb must be one of ${[...DONE_VERBS].join(", ")}`);
    }
    if (options.outcome !== undefined && !DONE_OUTCOMES.has(options.outcome)) {
      throw new BoardUsageError("--outcome must be done, failed, or cancelled");
    }
    const note =
      options["note-file"] !== undefined ? await fileText(options["note-file"]) : stdin.note;
    const payload = {
      ...stdin,
      ...(options.title ? { title: options.title } : {}),
      ...(options.verb ? { verb: options.verb } : {}),
      ...(options.outcome ? { outcome: options.outcome } : {}),
      ...(options.link.length > 0 ? { links: parseLinks(options.link) } : {}),
      ...(note ? { note } : {}),
      ...(options.agent ? { agentDisplay: options.agent } : {}),
    };
    screen([payload.title, payload.note, payload.agentDisplay]);
    const body = await scopedRequest(
      config,
      `/api/agent/board/work/${encodeURIComponent(key)}/done`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    return { body, exitCode: 0 };
  }

  if (action === "note") {
    const key = requireValue(options, "key", "note");
    if (options.clear) {
      const body = await scopedRequest(
        config,
        `/api/agent/board/notes/${encodeURIComponent(key)}`,
        {
          method: "DELETE",
        },
      );
      return { body, exitCode: 0 };
    }
    const text = positionals.join(" ") || stdin.text;
    if (!text) throw new BoardUsageError("board note requires the note text (or --clear)");
    const detail =
      options["detail-file"] !== undefined ? await fileText(options["detail-file"]) : stdin.detail;
    const payload = {
      ...stdin,
      key,
      text,
      ...(detail ? { detail } : {}),
      ...(options.link.length > 0 ? { link: parseLinks(options.link)[0].url } : {}),
      ...(options["expires-in"] ? { expiresInSeconds: parseDuration(options["expires-in"]) } : {}),
      ...(options.agent ? { agentDisplay: options.agent } : {}),
    };
    screen([payload.text, payload.detail, payload.agentDisplay]);
    const body = await scopedRequest(config, "/api/agent/board/notes", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    return { body, exitCode: 0 };
  }

  throw new BoardUsageError(
    "board verbs: ask, cancel, get, wait, answers, ack, work, done, note. Run sharkctl --help.",
  );
}

export const BOARD_HELP = `  sharkctl board ask --key <key> --title <title> [--body-file <path>] [--option <label|id=label[:style]>]...
                     [--allow-text] [--no-later] [--kind <decision|approval|merge|connect|todo>]
                     [--priority <p0|p1|p2>] [--task <id>] [--agent <name>] [--link <[kind=]url>]...
                     [--expires-in <duration>] [--push <auto|none>]
                     [--callback-url-env <VAR> --callback-token-file <path>] [--wait [--timeout <duration>]]
  sharkctl board cancel --key <key> [--reason <text>]
  sharkctl board get --key <key>
  sharkctl board wait --key <key> [--timeout <duration>]
  sharkctl board answers [--since <cursor>] [--limit <n>]
  sharkctl board ack --key <key>
  sharkctl board work --key <key> --title <title> --state <queued|in_flight|review|blocked>
                      [--status <label>] [--detail <text>] [--progress <0..1>] [--host <name>]
                      [--link <[kind=]url>]... [--waiting-ask <key>] [--heartbeat-ttl <duration>]
                      [--agent <name>]
  sharkctl board done --key <key> [--title <title>] [--verb <merged|shipped|done|closed|reported>]
                      [--outcome <done|failed|cancelled>] [--link <[kind=]url>]... [--note-file <path>]
                      [--agent <name>]
  sharkctl board note --key <key> <text> [--detail-file <path>] [--link <url>] [--expires-in <duration>]
                      [--agent <name>]
  sharkctl board note --key <key> --clear`;
