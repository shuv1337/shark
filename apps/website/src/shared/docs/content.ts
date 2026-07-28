/**
 * The docs prose, as data.
 *
 * This module is the single source of truth for everything on `/docs`. Two
 * consumers read it and neither owns any prose of its own:
 *
 * - `src/client/pages/docs/blocks.tsx` renders it as React (browser + the
 *   build-time prerender that puts the same HTML in the initial response).
 * - `src/shared/docs/markdown.ts` serialises it for `/docs.md` and `/agents.md`.
 *
 * Inline formatting inside every string is a tiny markdown subset — `` `code` ``
 * and `[text](href)` — parsed by `./inline.ts` for the React renderer and passed
 * through verbatim by the markdown serialiser. Keeping the source markdown-ish
 * means the two outputs cannot drift, and adding a section is a data edit.
 *
 * Headings are *not* stored here: they come from `./nav.ts` by id, so the
 * sidebar, the in-page headings, and the markdown outline always agree.
 */
import type { DocItemId, DocSectionId } from "./nav";

/** Placeholder webhook URL used throughout the docs samples. */
export const EXAMPLE_ENDPOINT = "https://shark.shuv.dev/hooks/whk_your_token";

export interface DocFieldRow {
  name: string;
  type: string;
  detail: string;
}

export interface DocRouteRow {
  method: string;
  path: string;
  detail: string;
}

export interface DocPlanRow {
  limit: string;
  value: string;
}

export type DocTableBlock =
  | { kind: "table"; variant: "field"; caption: string; rows: DocFieldRow[] }
  /** Same shape as `field`, headed "Flag" for CLI options. */
  | { kind: "table"; variant: "flag"; caption: string; rows: DocFieldRow[] }
  | { kind: "table"; variant: "route"; caption: string; rows: DocRouteRow[] }
  | { kind: "table"; variant: "plan"; caption: string; rows: DocPlanRow[] };

export type DocBlock =
  | { kind: "p"; text: string }
  /** Callout for a caveat that would get lost in a paragraph. */
  | { kind: "note"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "code"; language: "bash" | "json"; code: string }
  /** A copyable single-line value, rendered as a code block in markdown. */
  | { kind: "copy"; label: string; value: string }
  /** Illustrated gallery of the Live Activity layout styles. */
  | { kind: "stylePreviews"; styles: DocStylePreview[] }
  | DocTableBlock;

export interface DocStylePreview {
  name: string;
  description: string;
}

export interface DocSubsection {
  id: DocItemId;
  blocks: DocBlock[];
}

export interface DocSection {
  id: DocSectionId;
  /** Intro paragraph shown above the first subsection. */
  lead: string;
  subsections: DocSubsection[];
}

/** Page title, reused by the HTML `<h1>`, the prerendered `<title>`, and the markdown. */
export const DOCS_TITLE = "Webhooks to iPhone notifications";
export const DOCS_EYEBROW = "Documentation";
export const DOCS_URL = "https://shark.shuv.dev/docs";
export const DOCS_MARKDOWN_URL = "https://shark.shuv.dev/docs.md";

export const DOC_CONTENT: DocSection[] = [
  {
    id: "quickstart",
    lead: "SHark turns an HTTP request into a source-branded iPhone notification. Create a service, then POST JSON to its secret webhook URL.",
    subsections: [
      {
        id: "what-hark-is",
        blocks: [
          {
            kind: "p",
            text: "Anything that can send an HTTP request can notify your phone: CI jobs, coding agents, cron scripts, monitors. Each service carries its own name, avatar, and tap destination, and SHark fills in any field you omit from those service defaults.",
          },
          {
            kind: "p",
            text: "There are two APIs, both authenticated by the same webhook token. The Notification API sends one-shot pushes and optional approval prompts. The Activity API drives a stateful Live Activity on the Lock Screen and in the Dynamic Island.",
          },
        ],
      },
      {
        id: "create-a-service",
        blocks: [
          {
            kind: "steps",
            items: [
              "Sign in at [shark.shuv.dev](https://shark.shuv.dev).",
              "Register your iPhone with the SHark app.",
              "Create a service in the dashboard and give it a title, avatar, and tap URL.",
              "Copy the secret webhook URL it returns.",
            ],
          },
        ],
      },
      {
        id: "webhook-url",
        blocks: [
          {
            kind: "p",
            text: "The plaintext token is shown when the service is created and whenever you rotate it. Treat it as a credential: anyone holding it can notify your devices.",
          },
          { kind: "copy", label: "Webhook URL", value: EXAMPLE_ENDPOINT },
          {
            kind: "p",
            text: 'An unknown or rotated token returns `404` with `{ "ok": false, "error": "Unknown webhook" }`.',
          },
        ],
      },
      {
        id: "first-notification",
        blocks: [
          {
            kind: "p",
            text: "Only `body` is required. Everything else falls back to the service defaults.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT} \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: deploy-184-production' \\
  -d '{
    "body": "Production deployed successfully.",
    "title": "GitHub",
    "imageUrl": "https://github.com/github.png",
    "url": "https://github.com/acme/app/actions"
  }'`,
          },
        ],
      },
      {
        id: "quickstart-response",
        blocks: [
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1
}`,
          },
          {
            kind: "p",
            text: "`eventId` identifies the event in the dashboard activity log and, for interactive notifications, is the handle used to read or cancel the pending response. `delivered` is the number of push requests accepted by Expo.",
          },
          {
            kind: "note",
            text: "A request with no registered device still succeeds with `delivered: 0` and a `message` field, so an unpaired phone never fails your build.",
          },
        ],
      },
    ],
  },
  {
    id: "notification-api",
    lead: "One-shot pushes, delivered to every registered iPhone or to the devices you name. The webhook token in the URL is the only credential.",
    subsections: [
      {
        id: "notification-endpoint",
        blocks: [
          {
            kind: "table",
            variant: "route",
            caption: "Notification API routes",
            rows: [
              { method: "POST", path: "/hooks/:token", detail: "Send a notification." },
              {
                method: "GET",
                path: "/hooks/:token/events/:eventId",
                detail: "Read the state of an interactive response.",
              },
              {
                method: "POST",
                path: "/hooks/:token/events/:eventId/cancel",
                detail: "Withdraw a pending interactive response.",
              },
            ],
          },
          {
            kind: "p",
            text: "Send `Content-Type: application/json`. An unrecognised token returns `404`; a payload that fails validation returns `400` with an `issues` array describing each field.",
          },
        ],
      },
      {
        id: "notification-payload",
        blocks: [
          {
            kind: "table",
            variant: "field",
            caption: "Notification request fields",
            rows: [
              {
                name: "body",
                type: "string, required",
                detail: "Notification message, 1 to 2,000 characters after trimming.",
              },
              {
                name: "title",
                type: "string",
                detail: "Sender-name override, up to 80 characters. Defaults to the service title.",
              },
              {
                name: "imageUrl",
                type: "string",
                detail:
                  "Public HTTPS avatar URL, up to 2,048 characters. localhost, .local, loopback, link-local and private IP ranges are rejected.",
              },
              {
                name: "url",
                type: "string",
                detail:
                  "Destination opened when the notification is tapped. http and https only, so custom app schemes and javascript: or data: URLs never reach a device.",
              },
              {
                name: "deviceIds",
                type: "string[]",
                detail:
                  "1 to 50 device IDs from the dashboard. Omit to notify every active device.",
              },
              {
                name: "response",
                type: "object",
                detail: "Turns the notification into an approval, yes/no, or text prompt.",
              },
            ],
          },
        ],
      },
      {
        id: "notification-idempotency",
        blocks: [
          {
            kind: "p",
            text: "Send an optional `Idempotency-Key` header of 1 to 200 characters. Keys are scoped to a single service.",
          },
          {
            kind: "bullets",
            items: [
              "Same key and payload: the original event is returned with `idempotent: true`.",
              "Same key while the first request is still in flight: `202 Accepted`.",
              "Same key with a different payload: `409 Conflict`.",
              "Blank or over-length key: `400`.",
            ],
          },
        ],
      },
      {
        id: "device-routing",
        blocks: [
          {
            kind: "p",
            text: "By default a request fans out to every active iOS device on the account, most recently seen first. The private self-host accepts every active device.",
          },
          {
            kind: "p",
            text: "Pass a non-empty `deviceIds` array to target specific iPhones. Copy the stable device IDs from the dashboard. IDs that do not belong to the account return `400 Invalid device selection`; owned but inactive or non-iOS devices in the list are skipped silently.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "body": "The production deploy needs attention.",
  "deviceIds": ["dev_your_iphone_id"]
}`,
          },
        ],
      },
      {
        id: "rate-limits",
        blocks: [
          {
            kind: "table",
            variant: "plan",
            caption: "Self-hosted limits",
            rows: [
              { limit: "Requests per minute, per service", value: "300" },
              { limit: "Requests per minute, per account", value: "1,500" },
              { limit: "Notifications per month", value: "Unmetered" },
              { limit: "Active devices", value: "Unlimited" },
            ],
          },
          {
            kind: "p",
            text: "The per-minute counters use a rolling 60-second window and are shared across notifications, interactive responses, and Live Activity operations. A limited request returns `429` with a `Retry-After: 60` header and `retryAfterSeconds` in the body. Notifications are not metered monthly.",
          },
        ],
      },
      {
        id: "notification-response",
        blocks: [
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1
}`,
          },
          {
            kind: "table",
            variant: "field",
            caption: "Notification status codes",
            rows: [
              { name: "200", type: "ok", detail: "Accepted, or an idempotent replay." },
              { name: "202", type: "ok", detail: "An identical request is still processing." },
              { name: "400", type: "error", detail: "Invalid payload, key, or device selection." },
              { name: "404", type: "error", detail: "Unknown webhook token." },
              { name: "409", type: "error", detail: "Idempotency key reused with a new payload." },
              { name: "429", type: "error", detail: "Per-minute rate limit exhausted." },
              { name: "502", type: "error", detail: "Every push target was rejected by Expo." },
            ],
          },
          {
            kind: "p",
            text: "Provider errors can embed a device push token, so they are recorded in the dashboard activity log rather than returned to the caller. Use that log to find devices that are no longer registered.",
          },
        ],
      },
      {
        id: "interactive-responses",
        blocks: [
          {
            kind: "p",
            text: "SHark can attach a fixed response type to any notification. Supported types are `approval` (Approve or Deny), `yes_no` (Yes or No), and `text` (a short free-form reply).",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "title": "Production deploy",
  "body": "Deploy commit 8e7fc2a?",
  "response": {
    "type": "approval",
    "expiresInSeconds": 900,
    "correlationId": "deploy-184",
    "callback": {
      "url": "https://ci.example.com/hark-response",
      "token": "private-callback-token"
    }
  }
}`,
          },
          {
            kind: "table",
            variant: "field",
            caption: "Interactive response fields",
            rows: [
              {
                name: "type",
                type: "string, required",
                detail: "`approval`, `yes_no`, or `text`.",
              },
              {
                name: "expiresInSeconds",
                type: "integer",
                detail: "30 to 86,400. Defaults to 900.",
              },
              {
                name: "correlationId",
                type: "string",
                detail: "Your own identifier, up to 100 characters. Echoed back on the callback.",
              },
              {
                name: "callback.url",
                type: "string",
                detail: "Public HTTPS URL that receives the answer.",
              },
              {
                name: "callback.token",
                type: "string",
                detail:
                  "16 to 512 characters, sent back as a bearer token so you can verify SHark.",
              },
            ],
          },
          {
            kind: "p",
            text: "The response body gains a `response` object alongside the usual fields:",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1,
  "response": { "status": "pending", "expiresAt": "2026-07-25T18:19:04.000Z" }
}`,
          },
        ],
      },
      {
        id: "response-status",
        blocks: [
          {
            kind: "p",
            text: "Poll the event with the `eventId` from the send response, or withdraw it while it is still pending.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl ${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq

curl -X POST ${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq/cancel`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "event": {
    "id": "evt_Cxns2IdbF4H0TJYq",
    "response": {
      "status": "approved",
      "action": "approve",
      "text": null,
      "correlationId": "deploy-184",
      "respondedAt": "2026-07-25T18:06:52.000Z",
      "expiresAt": "2026-07-25T18:19:04.000Z"
    }
  }
}`,
          },
          {
            kind: "bullets",
            items: [
              "`status` is one of `pending`, `approved`, `denied`, `yes`, `no`, `replied`, `expired`, or `canceled`.",
              "For `text` prompts, `action` becomes `reply` and `text` holds the answer. For the other types `action` holds the chosen option and `text` is `null`.",
              "Reading a pending request after `expiresAt` settles it as `expired`.",
              "Cancel returns `404` if the response is not pending, and events belonging to another service are never visible.",
            ],
          },
        ],
      },
      {
        id: "response-callbacks",
        blocks: [
          {
            kind: "p",
            text: "When a callback is configured, SHark POSTs the answer to your URL with `Authorization: Bearer <callback.token>`, `Content-Type: application/json`, and a compatibility `Hark-Callbacks/1` user agent. Redirects are not followed and the request times out after 10 seconds.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "type": "notification.response",
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "correlationId": "deploy-184",
  "kind": "approval",
  "status": "approved",
  "action": "approve",
  "text": null,
  "respondedAt": "2026-07-25T18:06:52.000Z"
}`,
          },
          {
            kind: "p",
            text: "`kind` is `approval`, `yes_no`, or `reply` — a `text` request arrives as `reply`.",
          },
          {
            kind: "p",
            text: "Any response outside the 2xx range is a failure. SHark makes up to five attempts: once immediately, then after 30 seconds, 2 minutes, 10 minutes, and 1 hour. After the last attempt the callback is marked failed and is not retried, so treat the callback as at-least-once and key your handler on `eventId`.",
          },
          {
            kind: "note",
            text: "Callbacks fire only when someone actually answers. Prompts that expire or are canceled never call back — poll the event route if you need to observe those outcomes.",
          },
        ],
      },
    ],
  },
  {
    id: "activity-api",
    lead: "A Live Activity is a stateful card on the Lock Screen and in the Dynamic Island. Start one, push partial updates as work progresses, then end it. Same webhook token, nested routes.",
    subsections: [
      {
        id: "activity-start",
        blocks: [
          {
            kind: "table",
            variant: "route",
            caption: "Activity API routes",
            rows: [
              {
                method: "POST",
                path: "/hooks/:token/live-activities",
                detail: "Start an activity. Returns 201.",
              },
              {
                method: "GET",
                path: "/hooks/:token/live-activities/:id",
                detail: "Read the current state.",
              },
              {
                method: "PATCH",
                path: "/hooks/:token/live-activities/:id",
                detail: "Apply a partial update.",
              },
              {
                method: "POST",
                path: "/hooks/:token/live-activities/:id/end",
                detail: "Settle and dismiss the activity.",
              },
            ],
          },
          { kind: "p", text: "Only `title` and `status` are required." },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT}/live-activities \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: deploy-184-start' \\
  -d '{
    "title": "Deploy #184",
    "status": "Building",
    "progress": 0,
    "symbol": "build",
    "accentColor": "#FF9F0A"
  }'`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "activityId": "act_9Rk2wQpLm4Tz",
  "sequence": 0,
  "status": "active",
  "accepted": 1,
  "failed": 0,
  "state": { "title": "Deploy #184", "status": "Building", "progress": 0, "symbol": "build" },
  "expiresAt": "2026-07-26T02:04:11.000Z",
  "staleAt": "2026-07-25T22:04:11.000Z",
  "endedAt": null
}`,
          },
          {
            kind: "p",
            text: "Use `activityId` in the update and end routes. If you pass your own `key` when starting, that value works in the URL too, so a script can address its activity without storing the generated ID. `Idempotency-Key` works on all three write routes and is scoped to the service: a replay returns `idempotent: true`, and reusing a key with a different payload returns `409`.",
          },
          {
            kind: "note",
            text: "Live Activities need a device running a SHark build that has registered a push-to-start token. If no device qualifies, the start still returns `201` with `accepted: 0` and an explanatory `message`.",
          },
        ],
      },
      {
        id: "activity-update",
        blocks: [
          {
            kind: "p",
            text: "`PATCH` merges into the current state, so send only what changed. At least one field other than `ifSequence` is required. Each accepted update increments `sequence`.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X PATCH ${EXAMPLE_ENDPOINT}/live-activities/act_9Rk2wQpLm4Tz \\
  -H 'Content-Type: application/json' \\
  -d '{ "status": "Testing", "progress": 0.6, "accentColor": "#64D2FF" }'`,
          },
          {
            kind: "bullets",
            items: [
              "Pass `null` for `detail` or `progress` to clear the field.",
              "Pass `ifSequence` to make the write conditional. A mismatch returns `409 Sequence conflict` along with the current state so you can reconcile.",
              "Updating an activity that has already ended or expired returns `409 Live Activity is already terminal`.",
            ],
          },
        ],
      },
      {
        id: "activity-end",
        blocks: [
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT}/live-activities/act_9Rk2wQpLm4Tz/end \\
  -H 'Content-Type: application/json' \\
  -d '{ "status": "Deployed", "progress": 1, "symbol": "success" }'`,
          },
          {
            kind: "p",
            text: "The body is optional. `dismissAfterSeconds` (0 to 14,400, default 0) controls how long the finished card lingers on the Lock Screen before iOS removes it.",
          },
          {
            kind: "note",
            text: '`status` and `symbol` have defaults on this route, so omitting them overwrites the live values with `"Complete"` and `success`. Send them explicitly if you want the final card to read differently.',
          },
        ],
      },
      {
        id: "activity-fields",
        blocks: [
          {
            kind: "table",
            variant: "field",
            caption: "Live Activity fields",
            rows: [
              {
                name: "title",
                type: "string, required",
                detail: "Up to 80 characters. Required on start, optional on updates.",
              },
              { name: "status", type: "string, required", detail: "Short state line, up to 60." },
              { name: "detail", type: "string", detail: "Secondary line, up to 240. Nullable." },
              { name: "progress", type: "number", detail: "0 to 1 inclusive. Nullable." },
              {
                name: "symbol",
                type: "enum",
                detail:
                  "`terminal`, `code`, `build`, `success`, or `warning`. Defaults to `terminal`.",
              },
              {
                name: "accentColor",
                type: "string",
                detail: "Six-digit hex, `#RRGGBB`. Defaults to `#5ED8B7`.",
              },
              {
                name: "style",
                type: "enum",
                detail:
                  "`standard`, `ring`, `hero`, `terminal`, or `steps`. Defaults to `standard` and selects the widget layout. Updates can switch it mid-flight. App builds that predate a style fall back to the standard layout.",
              },
              {
                name: "privacyMode",
                type: "enum",
                detail:
                  "`standard` or `private`. Private replaces the start alert text with a generic line so the title and status stay off a locked screen.",
              },
              {
                name: "key",
                type: "string, start only",
                detail:
                  "Your own alias, up to 100 characters, usable in place of the activity ID. A key becomes reusable once its activity ends.",
              },
              {
                name: "replace",
                type: "boolean, start only",
                detail:
                  "End any Live Activity occupying a target device, and any of your own still holding the same `key`, before starting. Defaults to `false`. The response reports the displaced count as `replaced`.",
              },
              {
                name: "deviceIds",
                type: "string[]",
                detail: "1 to 50 device IDs. Omit to target every capable device.",
              },
            ],
          },
          {
            kind: "p",
            text: "The five layouts, rendered with the same state:",
          },
          {
            kind: "stylePreviews",
            styles: [
              {
                name: "standard",
                description:
                  "Icon, title over status, trailing percent, linear progress bar. The default.",
              },
              {
                name: "ring",
                description:
                  "A determinate capacity gauge with the percent centered; no linear bar.",
              },
              {
                name: "hero",
                description:
                  "Status becomes the headline, the title demotes to an eyebrow, and the bar runs edge to edge along the bottom of the card.",
              },
              {
                name: "terminal",
                description:
                  "Monospaced prompt treatment: the status lowercased behind a prompt glyph, the detail as a comment line.",
              },
              {
                name: "steps",
                description: "Progress quantized into five stage pips — phases, not percent.",
              },
            ],
          },
        ],
      },
      {
        id: "activity-lifetime",
        blocks: [
          {
            kind: "p",
            text: "`expiresInSeconds` accepts 60 to 28,800 and defaults to 28,800 — eight hours. Once an activity passes its expiry it is marked `expired` and stops accepting updates.",
          },
          {
            kind: "p",
            text: "`staleAfterSeconds` accepts 0 to 28,800 and defaults to 14,400 — four hours. Past that deadline iOS treats the content as possibly out of date, but the card stays visible and updateable. Every update rolls the deadline forward from now, clamped to the expiry. An update that omits `staleAfterSeconds` reuses the previous window.",
          },
        ],
      },
      {
        id: "activity-conflicts",
        blocks: [
          {
            kind: "p",
            text: "A device can host one SHark Live Activity at a time. Starting another while one is still live on a target device returns `409`:",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": false,
  "error": "A Live Activity is already active on a target device",
  "code": "ACTIVE_ACTIVITY_CONFLICT",
  "activityId": "act_9Rk2wQpLm4Tz"
}`,
          },
          {
            kind: "p",
            text: "The `activityId` is included only when the blocking activity belongs to the same service, so you can update it instead of starting over. Branch on `code` rather than the message text.",
          },
          {
            kind: "p",
            text: "To take the slot instead, pass `replace: true` in the start payload. SHark silently ends whatever occupies each target device — the old card is dismissed immediately, showing its last state — and then starts your activity. The success response reports how many activities were displaced as `replaced`; with nothing to displace the start behaves normally and `replaced` is `0`.",
          },
          {
            kind: "p",
            text: "`replace` also displaces activities started by your other services or API tokens, so a stale card from another integration cannot deadlock a device, though a foreign `activityId` is never disclosed. When the start carries a `key`, your live activity holding that key is ended everywhere — even on devices the start does not target — so the key always transfers to the new run. The implicit ends are not billed against your notification allowance. Combined with reusable keys this makes `key` plus `replace: true` a fixed-key restart you can send on every run.",
          },
        ],
      },
      {
        id: "activity-alerts",
        blocks: [
          {
            kind: "p",
            text: "A start carries an alert, so it may notify the user like a normal notification. Updates and ends carry no alert and are silent. SHark sends every Live Activity push at high APNs priority, which affects delivery speed only, not sound or haptics.",
          },
          {
            kind: "p",
            text: "Live Activity operations count against the same per-minute and monthly limits as notifications, so a chatty progress loop consumes the same budget. Throttle to meaningful state changes.",
          },
          {
            kind: "note",
            text: "iOS also budgets push-to-start deliveries per app. Rapid successive starts to the same device can be silently suppressed: the start still reports `accepted`, but the device never registers an update token, so every later update and end fails with `MissingUpdateToken`. Space fresh starts out by a minute or so — or keep one activity alive and update it, which is cheaper and never hits the budget.",
          },
        ],
      },
    ],
  },
  {
    id: "cli",
    lead: "`harkctl` wraps the agent API for terminals, scripts, and coding agents: one-shot notifications, questions with answers you can wait on, and Live Activities — no webhook URL required. It needs Node.js 22 or newer.",
    subsections: [
      {
        id: "cli-install",
        blocks: [
          {
            kind: "p",
            text: "Run it straight from npm with `npx harkctl`, or install it globally with `npm install -g harkctl`. Signing in uses a browser device-authorization flow — no tokens on the command line, ever.",
          },
          {
            kind: "code",
            language: "bash",
            code: "npx harkctl auth login",
          },
          {
            kind: "steps",
            items: [
              "The CLI prints a short code and opens [shark.shuv.dev](https://shark.shuv.dev) in your browser.",
              "Sign in and approve the requested scopes; every scope is shown before you approve.",
              "Credentials are written to an OS config file with mode `0600`, and the CLI polls until the approval lands.",
            ],
          },
          {
            kind: "p",
            text: "Each login appears under your dashboard's Services list as an agent connection, with its scopes, creation date, and last use. Revoking it there signs that agent out immediately. `harkctl auth status` shows the active connection; `harkctl auth logout` revokes and removes local credentials.",
          },
          {
            kind: "p",
            text: "Use repeatable `--scope` flags to narrow access, `--client-name` to label the connection, and `--expires-in` (default `90d`) to bound its lifetime. For CI or self-hosted setups, `HARK_TOKEN` and `HARK_API_URL` environment variables override the config file.",
          },
        ],
      },
      {
        id: "cli-service",
        blocks: [
          {
            kind: "p",
            text: "`harkctl services create` creates a persistent webhook endpoint for another tool or workflow. Its title, image, and tap URL become defaults, so the sender only needs to POST a `body`. The command prints the credential-bearing `webhookUrl` in its JSON response.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl services create \\
  --title "Release bot" \\
  --image https://example.com/bot.png \\
  --url https://ci.example.com/releases`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "service": {
    "id": "svc_...",
    "title": "Release bot",
    "imageUrl": "https://example.com/bot.png"
  },
  "webhookUrl": "https://shark.shuv.dev/hooks/hook_..."
}`,
          },
          {
            kind: "p",
            text: "Use `--stdin` to provide the same fields as JSON. `services list` lists existing services without emitting their webhook credentials. Creation requires `services:write`; if your CLI login predates that scope, sign in again and approve the updated permissions.",
          },
          {
            kind: "note",
            text: "Treat `webhookUrl` as a secret. Anyone who has it can send notifications through that service.",
          },
        ],
      },
      {
        id: "cli-notify",
        blocks: [
          {
            kind: "p",
            text: "`harkctl notify <body>` sends a one-shot push to every active iPhone on your account. Appearance is per call — the title acts as the sender name, and messages with the same title thread together like a service.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl notify "Build 48 passed" \\
  --title "CI" \\
  --image https://github.com/github.png \\
  --url https://ci.example.com/builds/48`,
          },
          {
            kind: "table",
            variant: "flag",
            caption: "notify flags",
            rows: [
              { name: "--title", type: "string", detail: "Sender name. Defaults to `SHark`." },
              {
                name: "--image",
                type: "url",
                detail: "Public HTTPS avatar, same rules as the webhook `imageUrl`.",
              },
              { name: "--url", type: "url", detail: "Opened when the notification is tapped." },
              {
                name: "--device",
                type: "id, repeatable",
                detail: "Target specific iPhones.",
              },
              {
                name: "--idempotency-key",
                type: "string",
                detail: "Safe retries: replays return the original result without a second push.",
              },
              {
                name: "--stdin",
                type: "boolean",
                detail: "Merge a JSON object from stdin under the explicit flags.",
              },
            ],
          },
          {
            kind: "note",
            text: "Sends from one connection share the webhook per-minute budgets — the requester counts like a service, the account window spans everything — and the same monthly notification allowance.",
          },
        ],
      },
      {
        id: "cli-ask",
        blocks: [
          {
            kind: "p",
            text: "`harkctl notify ask <prompt>` sends a push that elicits an answer. Pass exactly one response type: `--approval` (Approve/Deny), `--yes-no` (Yes/No), or `--text` (a short typed reply). The appearance flags from `notify` all apply.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl notify ask "Deploy 8e7fc2a to production?" \\
  --approval --title "Deploybot" --wait --timeout 15m`,
          },
          {
            kind: "p",
            text: "`--wait` blocks until the answer arrives or the timeout passes. `--poll` waits at most 20 seconds to catch an instant answer, for the case where someone is already looking at their phone. A timed-out poll or wait does not end the prompt — it stays answerable until it expires (default 15 minutes, `--expires-in` to change), and `harkctl interaction wait <id>` resumes waiting any time.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "interaction": {
    "id": "int_7MFuml-SqoUmpPLo",
    "kind": "reply",
    "status": "replied",
    "response": "ship it",
    "respondedAt": "2026-07-26T11:54:17.927Z"
  },
  "accepted": 1,
  "timedOut": false
}`,
          },
        ],
      },
      {
        id: "cli-activity",
        blocks: [
          {
            kind: "p",
            text: "The `activity` commands drive the Activity API end to end. Address an activity by the returned ID or by your own `--key`, and pick a layout with `--style`.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl activity start --key deploy --replace --style ring \\
  --title "Deploy #184" --status "Building" --progress 0.1

harkctl activity update deploy --status "Testing" --progress 0.6 --if-sequence 0

harkctl activity end deploy --status "Shipped" --progress 1 --dismiss-after 45s`,
          },
          {
            kind: "bullets",
            items: [
              "`--replace` takes the device slot and the key, ending whatever blocks them, so a fixed-key start works on every run.",
              "`--if-sequence` rejects stale writes: the update only applies if the activity is still at that sequence.",
              "`--style` selects `standard`, `ring`, `hero`, `terminal`, or `steps`, and can change mid-flight on `update`.",
              "`activity get <id|key>` reads current state; `activity list` shows recent activities.",
            ],
          },
        ],
      },
      {
        id: "cli-scripting",
        blocks: [
          {
            kind: "p",
            text: "Every successful command prints exactly one JSON object to stdout; diagnostics go to stderr. Exit codes make answers branchable without parsing:",
          },
          {
            kind: "bullets",
            items: [
              "`0` — success, approved, yes, or replied",
              "`4` — timed out, canceled, or expired",
              "`5` — denied or no",
              "`7` — no device accepted the push",
              "`1` API error · `2` usage error · `3` authentication or scope error · `6` network error",
            ],
          },
          {
            kind: "code",
            language: "bash",
            code: `if harkctl notify ask "Deploy to production?" --approval --wait --timeout 10m; then
  ./deploy.sh && harkctl notify "Deployed" --title "Deploybot"
else
  echo "Not approved" >&2
fi`,
          },
        ],
      },
    ],
  },
];
