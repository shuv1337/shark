import { z } from "zod";
import { publicHttpsUrlSchema } from "./url";

// ---------------------------------------------------------------------------
// SHark board (fork-only): durable asks, work items, and notes for a captain
// who supervises several agents. Agents write their own rows with a scoped
// token; only the captain's signed-in session can answer.
// ---------------------------------------------------------------------------

export const BOARD_KEY_MAX_CHARS = 200 as const;
export const BOARD_TITLE_MAX_CHARS = 120 as const;
export const BOARD_BODY_MAX_CHARS = 2000 as const;
export const BOARD_OPTION_LABEL_MAX_CHARS = 120 as const;
export const BOARD_MAX_OPTIONS = 6 as const;
export const BOARD_MAX_LINKS = 10 as const;
export const BOARD_ANSWER_TEXT_MAX_CHARS = 4000 as const;
/** Open asks one token may hold at once; a runaway agent cannot flood the board. */
export const BOARD_MAX_OPEN_ASKS_PER_TOKEN = 50 as const;
/** Longest explicit ask expiry; `null` means the ask persists until answered. */
export const BOARD_MAX_EXPIRES_IN_SECONDS = 366 * 86_400;
export const BOARD_DEFAULT_HEARTBEAT_TTL_SECONDS = 21_600 as const;
/** Asks open for longer than this collapse into "Older questions still open". */
export const BOARD_AGED_ASK_DAYS = 14 as const;
/** Recently done keeps this many days and at most this many rows. */
export const BOARD_DONE_WINDOW_DAYS = 14 as const;
export const BOARD_DONE_MAX_ITEMS = 50 as const;

export const BOARD_ASK_KINDS = ["decision", "approval", "merge", "connect", "todo"] as const;
export const boardAskKindSchema = z.enum(BOARD_ASK_KINDS);
export type BoardAskKind = z.infer<typeof boardAskKindSchema>;

export const BOARD_PRIORITIES = ["p0", "p1", "p2"] as const;
export const boardPrioritySchema = z.enum(BOARD_PRIORITIES);
export type BoardPriority = z.infer<typeof boardPrioritySchema>;

export const BOARD_ASK_STATUSES = ["open", "answered", "expired", "cancelled"] as const;
export const boardAskStatusSchema = z.enum(BOARD_ASK_STATUSES);
export type BoardAskStatus = z.infer<typeof boardAskStatusSchema>;

export const BOARD_ANSWER_VIAS = ["web", "ios_app", "ios_webview", "external"] as const;
export type BoardAnswerVia = (typeof BOARD_ANSWER_VIAS)[number];

export const BOARD_WORK_STATES = [
  "queued",
  "in_flight",
  "review",
  "blocked",
  "done",
  "failed",
  "cancelled",
] as const;
export const boardWorkStateSchema = z.enum(BOARD_WORK_STATES);
export type BoardWorkState = z.infer<typeof boardWorkStateSchema>;
/** States an agent may set through `PUT /work`; terminal states go through `done`. */
export const BOARD_WORK_ACTIVE_STATES = ["queued", "in_flight", "review", "blocked"] as const;
export const BOARD_COMPLETION_VERBS = ["merged", "shipped", "done", "closed", "reported"] as const;
export const boardCompletionVerbSchema = z.enum(BOARD_COMPLETION_VERBS);
export type BoardCompletionVerb = z.infer<typeof boardCompletionVerbSchema>;

export const BOARD_LINK_KINDS = ["pr", "issue", "linear", "source", "doc", "other"] as const;

/** Zero-width and other format characters would hide a secret from the screener while the card looks intact. */
const FORMAT_CHARACTER = /\p{Cf}/u;
const noFormatCharacters = (value: string) => !FORMAT_CHARACTER.test(value);

const multiLine = (max: number) =>
  z.string().trim().max(max).refine(noFormatCharacters, "Format characters are not allowed");

const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        Array.from(value).every((character) => {
          const code = character.charCodeAt(0);
          return code >= 32 && code !== 127;
        }),
      "Must be a single line",
    )
    .refine(noFormatCharacters, "Format characters are not allowed");

export const boardKeySchema = z
  .string()
  .trim()
  .min(1, "key is required")
  .max(BOARD_KEY_MAX_CHARS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._/#@-]*$/, "Keys use letters, digits, and : . _ / # @ -");

const httpsUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Must be an HTTPS URL");

export const boardLinkSchema = z.object({
  kind: z.enum(BOARD_LINK_KINDS).default("other"),
  url: httpsUrlSchema,
  label: singleLine(80).optional(),
});
export type BoardLink = z.infer<typeof boardLinkSchema>;

export const boardOptionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Option ids use letters, digits, _ and -"),
  label: singleLine(BOARD_OPTION_LABEL_MAX_CHARS),
  style: z.enum(["primary", "neutral", "destructive"]).default("neutral"),
});
export type BoardOption = z.infer<typeof boardOptionSchema>;

/** Public HTTPS callback, the same shape webhooks accept for interaction answers. */
export const boardCallbackSchema = z.object({
  url: publicHttpsUrlSchema,
  token: z.string().min(16).max(512),
});

export const boardAskUpsertSchema = z
  .object({
    key: boardKeySchema,
    title: singleLine(BOARD_TITLE_MAX_CHARS),
    body: multiLine(BOARD_BODY_MAX_CHARS).optional(),
    kind: boardAskKindSchema.default("decision"),
    options: z.array(boardOptionSchema).max(BOARD_MAX_OPTIONS).default([]),
    allowText: z.boolean().default(false),
    allowLater: z.boolean().default(true),
    priority: boardPrioritySchema.default("p1"),
    taskId: singleLine(100).optional(),
    agentDisplay: singleLine(60).optional(),
    links: z.array(boardLinkSchema).max(BOARD_MAX_LINKS).default([]),
    /** Null or omitted: the ask stays open until answered or cancelled. */
    expiresInSeconds: z.number().int().min(60).max(BOARD_MAX_EXPIRES_IN_SECONDS).nullish(),
    /** `auto` sends one push per revision for p0 and p1; `none` keeps it board-only. */
    push: z.enum(["auto", "none"]).default("auto"),
    callback: boardCallbackSchema.optional(),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const option of value.options) {
      if (ids.has(option.id)) {
        context.addIssue({
          code: "custom",
          path: ["options"],
          message: `Duplicate option id ${option.id}`,
        });
      }
      ids.add(option.id);
    }
    if (value.kind === "todo" && (value.options.length > 0 || value.allowText)) {
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message: "A todo has no options or text; the captain marks it done",
      });
    }
    if (value.kind !== "todo" && value.options.length === 0 && !value.allowText) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "An ask needs at least one option or allowText",
      });
    }
  });
export type BoardAskUpsertInput = z.infer<typeof boardAskUpsertSchema>;

export const boardAskCancelSchema = z.object({
  reason: singleLine(200).optional(),
});

/**
 * Re-posting a work key is the heartbeat, so an omitted optional field keeps its stored value.
 * `null` clears a field (`heartbeatTtlSeconds: null` restores the default) and `links: []` clears
 * the links. The waiting ask is kept only while the work stays `blocked`.
 */
export const boardWorkUpsertSchema = z.object({
  key: boardKeySchema,
  title: singleLine(BOARD_TITLE_MAX_CHARS),
  state: z.enum(BOARD_WORK_ACTIVE_STATES),
  statusLabel: singleLine(60).nullable().optional(),
  detail: multiLine(240).nullable().optional(),
  progress: z.number().min(0).max(1).nullable().optional(),
  links: z.array(boardLinkSchema).max(BOARD_MAX_LINKS).optional(),
  host: singleLine(60).nullable().optional(),
  agentDisplay: singleLine(60).nullable().optional(),
  /** Key of one of this account's asks that this work is waiting on; an unknown key is refused. */
  waitingAskKey: boardKeySchema.nullable().optional(),
  /** Defaults to {@link BOARD_DEFAULT_HEARTBEAT_TTL_SECONDS} for a new work item. */
  heartbeatTtlSeconds: z
    .number()
    .int()
    .min(60)
    .max(7 * 86_400)
    .nullable()
    .optional(),
});
export type BoardWorkUpsertInput = z.infer<typeof boardWorkUpsertSchema>;

export const boardDoneSchema = z.object({
  key: boardKeySchema,
  title: singleLine(BOARD_TITLE_MAX_CHARS).optional(),
  verb: boardCompletionVerbSchema.default("done"),
  /** `failed` or `cancelled` record an unsuccessful end; default is `done`. */
  outcome: z.enum(["done", "failed", "cancelled"]).default("done"),
  links: z.array(boardLinkSchema).max(BOARD_MAX_LINKS).default([]),
  note: multiLine(600).optional(),
  agentDisplay: singleLine(60).optional(),
});
export type BoardDoneInput = z.infer<typeof boardDoneSchema>;

export const boardNoteUpsertSchema = z.object({
  key: boardKeySchema,
  text: singleLine(300),
  detail: multiLine(2000).optional(),
  link: httpsUrlSchema.optional(),
  expiresInSeconds: z.number().int().min(60).max(BOARD_MAX_EXPIRES_IN_SECONDS).nullish(),
  agentDisplay: singleLine(60).optional(),
});
export type BoardNoteUpsertInput = z.infer<typeof boardNoteUpsertSchema>;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Captain answer. Exactly one of `optionId` or `text`; `done` closes a todo. */
export const boardAnswerSchema = z
  .object({
    digest: digestSchema,
    optionId: z.string().trim().min(1).max(40).optional(),
    text: z.string().trim().min(1).max(BOARD_ANSWER_TEXT_MAX_CHARS).optional(),
  })
  .refine(
    (value) => (value.optionId === undefined) !== (value.text === undefined),
    "Provide either optionId or text",
  );
export type BoardAnswerInput = z.infer<typeof boardAnswerSchema>;

export const boardSnoozeSchema = z.object({
  digest: digestSchema,
  /** ISO date or datetime; the ask leaves Waiting on you until then. */
  until: z.iso.datetime({ offset: true }).or(z.iso.date()),
});
export type BoardSnoozeInput = z.infer<typeof boardSnoozeSchema>;

export const boardDismissSchema = z.object({
  digest: digestSchema,
  reason: singleLine(200).optional(),
});
export type BoardDismissInput = z.infer<typeof boardDismissSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface BoardCallbackStateDto {
  status: "pending" | "retrying" | "delivered" | "failed";
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
}

export interface BoardAskDto {
  id: string;
  key: string;
  revision: number;
  agent: string;
  agentDisplay: string | null;
  title: string;
  body: string | null;
  kind: BoardAskKind;
  options: BoardOption[];
  allowText: boolean;
  allowLater: boolean;
  priority: BoardPriority;
  taskId: string | null;
  links: BoardLink[];
  status: BoardAskStatus;
  /** Echoed by every captain action so a click on a stale revision is refused. */
  digest: string;
  snoozeUntil: string | null;
  expiresAt: string | null;
  answer: {
    optionId: string | null;
    optionLabel: string | null;
    text: string | null;
    answeredAt: string;
    via: BoardAnswerVia;
  } | null;
  cancelReason: string | null;
  /** Null when no callback was registered. */
  callback: BoardCallbackStateDto | null;
  /** Set once the agent confirmed it applied the answer. */
  ackedAt: string | null;
  lastAssertedAt: string;
  createdAt: string;
  updatedAt: string;
  /** Open longer than BOARD_AGED_ASK_DAYS; the UI collapses these. */
  aged: boolean;
}

export interface BoardAskEventDto {
  id: string;
  kind: string;
  actorType: "token" | "session" | "device_credential" | "system";
  revision: number;
  detail: string | null;
  occurredAt: string;
}

export interface BoardWorkItemDto {
  id: string;
  key: string;
  agent: string;
  agentDisplay: string | null;
  title: string;
  state: BoardWorkState;
  statusLabel: string | null;
  detail: string | null;
  progress: number | null;
  links: BoardLink[];
  host: string | null;
  waitingAskId: string | null;
  startedAt: string | null;
  lastHeartbeatAt: string;
  heartbeatTtlSeconds: number;
  /** True when the last heartbeat is older than the TTL and the item is still active. */
  stale: boolean;
  completedAt: string | null;
  completionVerb: BoardCompletionVerb | null;
  note: string | null;
  updatedAt: string;
}

export interface BoardNoteDto {
  id: string;
  key: string;
  agent: string;
  agentDisplay: string | null;
  text: string;
  detail: string | null;
  link: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface BoardCrewEntryDto {
  tokenId: string;
  agent: string;
  lastSeenAt: string | null;
  openAsks: number;
  inFlight: number;
}

export interface BoardPageDto {
  waiting: BoardAskDto[];
  /** Answered or dismissed asks the agent has not acknowledged yet. */
  withAgent: BoardAskDto[];
  inFlight: BoardWorkItemDto[];
  queued: BoardWorkItemDto[];
  notes: BoardNoteDto[];
  /** Completed work and answered asks from the last BOARD_DONE_WINDOW_DAYS. */
  done: Array<{ kind: "work"; item: BoardWorkItemDto } | { kind: "ask"; item: BoardAskDto }>;
  crew: BoardCrewEntryDto[];
  /** Opaque change marker; the stream announces a new one on every change. */
  cursor: string;
  generatedAt: string;
}

/** One terminal transition, as returned by `GET /answers` and sent to callbacks. */
export interface BoardAskResolvedEvent {
  type: "board.ask.resolved";
  eventId: string;
  askId: string;
  askKey: string;
  revision: number;
  status: Exclude<BoardAskStatus, "open">;
  optionId: string | null;
  optionLabel: string | null;
  text: string | null;
  answeredAt: string | null;
  answeredVia: BoardAnswerVia | null;
  cancelReason: string | null;
  waitingTaskId: string | null;
  agent: string;
}

export interface BoardAnswersPageDto {
  events: BoardAskResolvedEvent[];
  /** Pass back as `since` to read only newer events. */
  cursor: string;
}

// ---------------------------------------------------------------------------
// Secret screening shared by the server (422) and sharkctl (exit 2)
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "SHark API token", pattern: /\bhark_[A-Za-z0-9_-]{40,}/ },
  { name: "SHark webhook URL", pattern: /\/hooks\/whk_[A-Za-z0-9_-]{10,}/ },
  {
    name: "GitHub token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/,
  },
  { name: "OpenAI-style key", pattern: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/ },
  { name: "Slack token", pattern: /\bxox[abpres]-[A-Za-z0-9-]{10,}/ },
  { name: "AWS access key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{32,}=*/i },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

/**
 * Returns the name of the first secret-looking pattern found in `text`, or
 * null. Deliberately conservative: it stops obvious pastes, not a determined
 * agent, and must never produce false positives on PR URLs or task ids.
 */
export function findBoardSecret(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}
