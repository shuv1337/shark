/** Board agent calls. No framework imports so the shapes can be unit-tested directly. */

import {
  clampSeconds,
  DEFAULT_WAIT_SECONDS,
  MAX_WAIT_SECONDS,
  normalizeAgentDisplay,
  SharkError,
  screenText,
  segment,
} from "./shark";

export const BOARD_ASK_KINDS = ["decision", "approval", "merge", "connect", "todo"] as const;
export const BOARD_PRIORITIES = ["p0", "p1", "p2"] as const;
export const BOARD_OPTION_STYLES = ["primary", "neutral", "destructive"] as const;
export const BOARD_LINK_KINDS = ["pr", "issue", "linear", "source", "doc", "other"] as const;
export const BOARD_WORK_STATES = ["queued", "in_flight", "review", "blocked"] as const;
export const BOARD_DONE_VERBS = ["merged", "shipped", "done", "closed", "reported"] as const;
export const BOARD_DONE_OUTCOMES = ["done", "failed", "cancelled"] as const;

export interface BoardCall {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
}

export interface BoardLinkInput {
  kind?: string;
  url: string;
  label?: string;
}

export interface BoardOptionInput {
  id: string;
  label: string;
  style?: string;
}

export interface BoardAskInput {
  key: string;
  title: string;
  body?: string;
  kind?: string;
  options?: BoardOptionInput[];
  allowText?: boolean;
  allowLater?: boolean;
  priority?: string;
  taskId?: string;
  agentDisplay?: string;
  links?: BoardLinkInput[];
  expiresInSeconds?: number | null;
  push?: string;
  callbackUrl?: string;
}

export interface BoardWorkInput {
  key: string;
  title: string;
  state: string;
  statusLabel?: string | null;
  detail?: string | null;
  progress?: number | null;
  links?: BoardLinkInput[];
  host?: string | null;
  agentDisplay?: string | null;
  waitingAskKey?: string | null;
  heartbeatTtlSeconds?: number | null;
}

export interface BoardDoneInput {
  title?: string;
  verb?: string;
  outcome?: string;
  links?: BoardLinkInput[];
  note?: string;
  /** Final label. Null clears; omit it and the server clears the in-flight label. */
  statusLabel?: string | null;
  agentDisplay?: string;
}

export interface BoardNoteInput {
  key: string;
  text: string;
  detail?: string;
  link?: string;
  expiresInSeconds?: number | null;
  agentDisplay?: string;
}

function oneOf(value: string, allowed: readonly string[], name: string): string {
  if (!allowed.includes(value)) {
    throw new SharkError(`${name} must be one of: ${allowed.join(", ")}`, 400, "invalid_input");
  }
  return value;
}

function display(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return normalizeAgentDisplay(value);
}

function screenFields(values: Array<string | null | undefined>): void {
  for (const value of values) screenText(value ?? undefined);
}

export function boardAskCall(input: BoardAskInput, callbackToken: string | undefined): BoardCall {
  if (input.callbackUrl !== undefined && (!callbackToken || callbackToken.length < 16)) {
    throw new SharkError(
      "callbackUrl needs the SHark account's board callback token secret",
      400,
      "invalid_input",
    );
  }
  const agentDisplay = display(input.agentDisplay);
  screenFields([
    input.title,
    input.body,
    input.taskId,
    typeof agentDisplay === "string" ? agentDisplay : undefined,
    ...(input.options ?? []).map((option) => option.label),
    ...(input.links ?? []).flatMap((link) => [link.label, link.url]),
  ]);
  const body: Record<string, unknown> = {
    key: input.key,
    title: input.title,
  };
  if (input.body !== undefined) body.body = input.body;
  if (input.kind !== undefined) body.kind = oneOf(input.kind, BOARD_ASK_KINDS, "kind");
  if (input.options !== undefined) body.options = input.options;
  if (input.allowText !== undefined) body.allowText = input.allowText;
  if (input.allowLater !== undefined) body.allowLater = input.allowLater;
  if (input.priority !== undefined) {
    body.priority = oneOf(input.priority, BOARD_PRIORITIES, "priority");
  }
  if (input.taskId !== undefined) body.taskId = input.taskId;
  if (agentDisplay !== undefined) body.agentDisplay = agentDisplay;
  if (input.links !== undefined) body.links = input.links;
  if (input.expiresInSeconds !== undefined) body.expiresInSeconds = input.expiresInSeconds;
  if (input.push !== undefined) body.push = oneOf(input.push, ["auto", "none"], "push");
  if (input.callbackUrl !== undefined && callbackToken !== undefined) {
    body.callback = { url: input.callbackUrl, token: callbackToken };
  }
  return { method: "PUT", path: "/api/agent/board/asks", body };
}

export function boardCancelCall(key: string, reason: string | undefined): BoardCall {
  screenText(reason);
  return {
    method: "POST",
    path: `/api/agent/board/asks/${segment(key)}/cancel`,
    ...(reason === undefined ? {} : { body: { reason } }),
  };
}

export function boardGetCall(key: string): BoardCall {
  return { method: "GET", path: `/api/agent/board/asks/${segment(key)}` };
}

/** One long-poll. The server holds a request for at most 25 seconds. */
export function boardWaitCall(key: string, timeoutSeconds: number | undefined): BoardCall {
  const timeout = clampSeconds(timeoutSeconds, DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS, 0);
  return {
    method: "GET",
    path: `/api/agent/board/asks/${segment(key)}/wait?timeout=${timeout}`,
  };
}

export function boardAnswersCall(since: string | undefined, limit: number | undefined): BoardCall {
  const params = new URLSearchParams();
  if (since !== undefined && since !== "") params.set("since", since);
  if (limit !== undefined) params.set("limit", String(clampSeconds(limit, 100, 100, 1)));
  const query = params.toString();
  return { method: "GET", path: `/api/agent/board/answers${query ? `?${query}` : ""}` };
}

export function boardAckCall(key: string): BoardCall {
  return { method: "POST", path: `/api/agent/board/asks/${segment(key)}/ack` };
}

export function boardWorkCall(input: BoardWorkInput): BoardCall {
  const agentDisplay = display(input.agentDisplay);
  oneOf(input.state, BOARD_WORK_STATES, "state");
  screenFields([
    input.title,
    input.statusLabel,
    input.detail,
    input.host,
    typeof agentDisplay === "string" ? agentDisplay : undefined,
    ...(input.links ?? []).flatMap((link) => [link.label, link.url]),
  ]);
  const body: Record<string, unknown> = {
    key: input.key,
    title: input.title,
    state: input.state,
  };
  if (input.statusLabel !== undefined) body.statusLabel = input.statusLabel;
  if (input.detail !== undefined) body.detail = input.detail;
  if (input.progress !== undefined) body.progress = input.progress;
  if (input.links !== undefined) body.links = input.links;
  if (input.host !== undefined) body.host = input.host;
  if (agentDisplay !== undefined) body.agentDisplay = agentDisplay;
  if (input.waitingAskKey !== undefined) body.waitingAskKey = input.waitingAskKey;
  if (input.heartbeatTtlSeconds !== undefined) body.heartbeatTtlSeconds = input.heartbeatTtlSeconds;
  return { method: "PUT", path: "/api/agent/board/work", body };
}

export function boardWorkGetCall(key: string): BoardCall {
  return { method: "GET", path: `/api/agent/board/work/${segment(key)}` };
}

export function boardDoneCall(key: string, input: BoardDoneInput): BoardCall {
  const agentDisplay = display(input.agentDisplay);
  if (input.verb !== undefined) oneOf(input.verb, BOARD_DONE_VERBS, "verb");
  if (input.outcome !== undefined) oneOf(input.outcome, BOARD_DONE_OUTCOMES, "outcome");
  screenFields([
    input.title,
    input.note,
    input.statusLabel,
    typeof agentDisplay === "string" ? agentDisplay : undefined,
    ...(input.links ?? []).flatMap((link) => [link.label, link.url]),
  ]);
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.title = input.title;
  if (input.verb !== undefined) body.verb = input.verb;
  if (input.outcome !== undefined) body.outcome = input.outcome;
  if (input.links !== undefined) body.links = input.links;
  if (input.note !== undefined) body.note = input.note;
  if (input.statusLabel !== undefined) body.statusLabel = input.statusLabel;
  if (agentDisplay !== undefined) body.agentDisplay = agentDisplay;
  return { method: "POST", path: `/api/agent/board/work/${segment(key)}/done`, body };
}

export function boardNoteCall(input: BoardNoteInput): BoardCall {
  const agentDisplay = display(input.agentDisplay);
  screenFields([input.text, input.detail, input.link, agentDisplay ?? undefined]);
  const body: Record<string, unknown> = { key: input.key, text: input.text };
  if (input.detail !== undefined) body.detail = input.detail;
  if (input.link !== undefined) body.link = input.link;
  if (input.expiresInSeconds !== undefined) body.expiresInSeconds = input.expiresInSeconds;
  if (agentDisplay !== undefined) body.agentDisplay = agentDisplay;
  return { method: "PUT", path: "/api/agent/board/notes", body };
}

export function boardNoteClearCall(key: string): BoardCall {
  return { method: "DELETE", path: `/api/agent/board/notes/${segment(key)}` };
}

const linkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: {
    kind: { type: "string", enum: [...BOARD_LINK_KINDS] },
    url: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1, maxLength: 80 },
  },
} as const;

const optionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 40 },
    label: { type: "string", minLength: 1, maxLength: 120 },
    style: { type: "string", enum: [...BOARD_OPTION_STYLES] },
  },
} as const;

const nullableString = (max: number) => ({
  anyOf: [{ type: "string", minLength: 1, maxLength: max }, { type: "null" }],
});

/** JSON Schemas for Executor discovery. Null clears a stored field on work heartbeats. */
export const boardToolSchemas = {
  ask: {
    type: "object",
    additionalProperties: false,
    required: ["key", "title"],
    properties: {
      key: { type: "string", minLength: 1, maxLength: 200 },
      title: { type: "string", minLength: 1, maxLength: 120 },
      body: { type: "string", maxLength: 2000 },
      kind: { type: "string", enum: [...BOARD_ASK_KINDS] },
      options: { type: "array", maxItems: 6, items: optionSchema },
      allowText: { type: "boolean" },
      allowLater: { type: "boolean" },
      priority: { type: "string", enum: [...BOARD_PRIORITIES] },
      taskId: { type: "string", minLength: 1, maxLength: 100 },
      agentDisplay: { type: "string", minLength: 1, maxLength: 60 },
      links: { type: "array", maxItems: 10, items: linkSchema },
      expiresInSeconds: { anyOf: [{ type: "integer", minimum: 60 }, { type: "null" }] },
      push: { type: "string", enum: ["auto", "none"] },
      callbackUrl: {
        type: "string",
        description: "Public HTTPS callback. The token is the account's boardCallbackToken secret.",
      },
    },
  },
  work: {
    type: "object",
    additionalProperties: false,
    required: ["key", "title", "state"],
    properties: {
      key: { type: "string", minLength: 1, maxLength: 200 },
      title: { type: "string", minLength: 1, maxLength: 120 },
      state: { type: "string", enum: [...BOARD_WORK_STATES] },
      statusLabel: nullableString(60),
      detail: { anyOf: [{ type: "string", maxLength: 240 }, { type: "null" }] },
      progress: { anyOf: [{ type: "number", minimum: 0, maximum: 1 }, { type: "null" }] },
      links: { type: "array", maxItems: 10, items: linkSchema },
      host: nullableString(60),
      agentDisplay: nullableString(60),
      waitingAskKey: {
        anyOf: [{ type: "string", minLength: 1, maxLength: 200 }, { type: "null" }],
      },
      heartbeatTtlSeconds: {
        anyOf: [{ type: "integer", minimum: 60, maximum: 7 * 86_400 }, { type: "null" }],
      },
    },
  },
  // Unknown fields are left off the request. The previous tool schema omitted them rather than
  // rejecting the call, so this object does not set additionalProperties: false.
  done: {
    type: "object",
    required: ["key"],
    properties: {
      key: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      verb: { type: "string" },
      outcome: { type: "string" },
      links: {
        type: "array",
        items: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", minLength: 1 },
            kind: { type: "string" },
            label: { type: "string" },
          },
        },
      },
      note: { type: "string" },
      statusLabel: {
        description:
          "Final label of at most 60 characters. Omit or null clears the in-flight status label.",
        anyOf: [{ type: "string", minLength: 1, maxLength: 60 }, { type: "null" }],
      },
      agentDisplay: { type: "string", minLength: 1 },
    },
  },
  note: {
    type: "object",
    additionalProperties: false,
    required: ["key", "text"],
    properties: {
      key: { type: "string", minLength: 1, maxLength: 200 },
      text: { type: "string", minLength: 1, maxLength: 300 },
      detail: { type: "string", maxLength: 2000 },
      link: { type: "string" },
      expiresInSeconds: { anyOf: [{ type: "integer", minimum: 60 }, { type: "null" }] },
      agentDisplay: { type: "string", minLength: 1, maxLength: 60 },
    },
  },
} as const;
