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

/** The remote MCP server. */
export const MCP_SERVER_URL = "https://shark.shuv.dev/mcp";

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
            text: "`eventId` identifies the event in the dashboard activity log, can withdraw the delivered notification, and, for interactive notifications, is the handle used to read or cancel the pending response. `delivered` is the number of push requests accepted by Expo, browsers, and macOS.",
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
                detail: "Cancel a pending interactive response only.",
              },
              {
                method: "POST",
                path: "/hooks/:token/events/:eventId/withdraw",
                detail: "Request removal of a delivered notification.",
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
            kind: "p",
            text: "Push previews may shorten long messages to fit delivery limits. If needed, images and then tap links are omitted from the push. The inbox keeps the complete notification or interaction prompt and its links.",
          },
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
            text: "The per-minute counters use a rolling 60-second window and are shared across webhook notifications, agent notifications (including board ask pushes and their retries), interactive responses, on-call pages, and Live Activity operations. The per-service limit also bounds each agent token. A limited request returns `429` with a `Retry-After: 60` header and `retryAfterSeconds` in the body. Notifications are not metered monthly.",
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
            text: "Poll the event with the `eventId` from the send response, or cancel that pending interactive response. Cancel does not remove a delivered banner; use withdraw for that.",
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
        id: "notification-withdrawal",
        blocks: [
          {
            kind: "p",
            text: "Keep the `eventId` returned when you send a notification, then POST `/withdraw` to ask SHark to remove that banner from registered iPhones, browsers, and the macOS companion. This is separate from `/cancel`, which only settles a pending interactive response.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST \\
  '${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq/withdraw'`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "status": "withdrawn",
  "accepted": 1
}`,
          },
          {
            kind: "bullets",
            items: [
              "`accepted` counts silent commands accepted by Expo, the browser push service, and APNs. It does not mean the operating system removed the banner.",
              "`status` is `withdrawn` when every selected target accepted the command, or `withdraw_partial` when at least one did. A later call returns the same terminal status with `idempotent: true` and sends nothing.",
              "Background delivery is best effort and may be delayed or skipped, particularly after a force-quit. macOS Notification Center removal also requires the companion to handle the silent push.",
              "The same webhook token must own the event. An unknown or unauthorized token returns `404`.",
            ],
          },
        ],
      },
      {
        id: "response-callbacks",
        blocks: [
          {
            kind: "p",
            text: "When a callback is configured, SHark POSTs the answer to your URL with `Authorization: Bearer <callback.token>`, `Content-Type: application/json`, and a compatibility `Hark-Callbacks/1` user agent. The URL must use HTTPS; any port is allowed, and `443` is used when none is given. Redirects are not followed, the request times out after 10 seconds, and the response body is discarded: SHark closes the connection as soon as it has the status. Every address the callback hostname resolves to must be public; a name that resolves to a private, loopback, link-local, or reserved address is refused without retrying.",
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
            text: "`PATCH` merges into the current state, so send only what changed. `status` alone is a valid update, and so is `status` with `progress`. At least one field other than `ifSequence` is required: `title`, `status`, `detail`, `progress`, `symbol`, `privacyMode`, `accentColor`, `style`, or `staleAfterSeconds`. Each stored update increments `sequence`. A `partial` activity stays updatable and endable.",
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
              "A 400 includes `issues` and `diagnostic`. Each issue has `path` and `message`; other validator keys such as `code` may be present and should be ignored. `diagnostic` names each rejected field, including unrecognized keys. Neither echoes submitted values.",
              "Update and end dispatch only to deliveries still `pending`, `accepted`, or `active`. Agent and webhook routes match. A delivery already `failed` with no update token is skipped: the response is `accepted: 0`, `failed: 0`, and does not set `updateTokenPending`. The delivery keeps its previous APNs reason, and that stored end is not replayed.",
              "Updating or ending an activity whose status is `ended`, `expired`, or `failed` returns `409`. The error is `Live Activity is already terminal (<status>)`, and the body includes `status`, `endedAt`, `expiresAt`, and `diagnostic` (`rejected state: <status>`). Agent responses also include `activity`. The row stays updatable until an explicit end, a replace takeover, a non-retryable delivery failure, or its expiry. A start that no device accepts is also stored as `failed`. Restart a still-running task with the same key and `replace: true` when the status is `ended` or `failed` and `expiresAt` is still in the future. If no device accepts that restart either, do not restart again; check the registered devices and the start `message`.",
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
                detail: "Six-digit hex, `#RRGGBB`. Defaults to `#D35C46`.",
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
            text: "iOS also budgets push-to-start deliveries per app. Rapid successive starts to the same device can be silently suppressed: the start still reports `accepted`, but the device never registers an update token. A later update or end still stores the requested state and reports `updateTokenPending: true` with `MissingUpdateToken` while `accepted` stays 0, until that token arrives. SHark then replays a stored end. A stored update is not pushed later by itself. Space fresh starts out by a minute or so — or keep one activity alive and update it, which is cheaper and never hits the budget.",
          },
        ],
      },
    ],
  },
  {
    id: "cli",
    lead: "`sharkctl` wraps the agent API for terminals, scripts, and coding agents: one-shot notifications, questions with answers you can wait on, and Live Activities — no webhook URL required. It needs Node.js 22 or newer.",
    subsections: [
      {
        id: "cli-install",
        blocks: [
          {
            kind: "p",
            text: "Run the SHark fork straight from npm with `npx sharkctl`, or install it globally with `npm install -g sharkctl`. The upstream `harkctl` package is not the SHark fork. Signing in uses a browser device-authorization flow — no tokens on the command line, ever.",
          },
          {
            kind: "code",
            language: "bash",
            code: "npx sharkctl auth login",
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
            text: "Each login appears under your dashboard's Services list as an agent connection, with its scopes, creation date, and last use. Revoking it there signs that agent out immediately. `sharkctl auth status` shows the active connection; `sharkctl auth logout` revokes and removes local credentials.",
          },
          {
            kind: "note",
            text: "`sharkctl` keeps the existing protected `hark` config path and `HARK_*` environment variables so credentials and integrations created before the CLI rename continue to work.",
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
            text: "`sharkctl services create` creates a persistent webhook endpoint for another tool or workflow. Its title, image, and tap URL become defaults, so the sender only needs to POST a `body`. The command prints the credential-bearing `webhookUrl` in its JSON response.",
          },
          {
            kind: "code",
            language: "bash",
            code: `sharkctl services create \\
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
            text: "`sharkctl notify <body>` sends a one-shot push to every active iPhone on your account. Appearance is per call — the title acts as the sender name, and messages with the same title thread together like a service.",
          },
          {
            kind: "code",
            language: "bash",
            code: `sharkctl notify "Build 48 passed" \\
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
            text: "`sharkctl notify ask <prompt>` sends a push that elicits an answer. Pass exactly one response type: `--approval` (Approve/Deny), `--yes-no` (Yes/No), or `--text` (a short typed reply). The appearance flags from `notify` all apply.",
          },
          {
            kind: "code",
            language: "bash",
            code: `sharkctl notify ask "Deploy 8e7fc2a to production?" \\
  --approval --title "Deploybot" --wait --timeout 15m`,
          },
          {
            kind: "p",
            text: "`--wait` blocks until the answer arrives or the timeout passes. `--poll` waits at most 20 seconds to catch an instant answer, for the case where someone is already looking at their phone. A timed-out poll or wait does not end the prompt — it stays answerable until it expires (default 15 minutes, `--expires-in` to change), and `sharkctl interaction wait <id>` resumes waiting any time.",
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
            code: `sharkctl activity start --key deploy --replace --style ring \\
  --title "Deploy #184" --status "Building" --progress 0.1

sharkctl activity update deploy --status "Testing" --progress 0.6 --if-sequence 0

sharkctl activity end deploy --status "Shipped" --progress 1 --dismiss-after 45s`,
          },
          {
            kind: "bullets",
            items: [
              "`--replace` takes the device slot and the key, ending whatever blocks them, so a fixed-key start works on every run.",
              "`--if-sequence` rejects stale writes: the update only applies if the activity is still at that sequence.",
              "`--style` selects `standard`, `ring`, `hero`, `terminal`, or `steps`, and can change mid-flight on `update`.",
              "`activity update` merges the fields you pass. `--status` alone is valid. An update with no field other than `--if-sequence` exits `2`.",
              "`activity get <id|key>` reads current state before a progress update. Continue while the status is `starting`, `active`, or `partial`. `activity list` shows recent activities.",
              'An update or end before the phone registers the activity update token returns `accepted: 0`, `message: "MissingUpdateToken"`, and `updateTokenPending: true` (exit `0`). Start does not return that token and still exits `7` when nothing accepts the push. The sequence has advanced. A stored update is not replayed by itself; a stored end is, once iOS registers the token. Exit `7` remains when `accepted` is 0 and `updateTokenPending` is absent. Once APNs rejects a registered update token (for example `Unregistered` after the activity is dismissed), later updates and ends keep that reason and, when no other device accepts, exit `7` until the phone registers a new token. When every delivery is already failed and has no update token, the update or end is stored, `accepted` and `failed` are both 0, `updateTokenPending` is absent, and the command exits `7`. Agent and webhook routes match. That end is not replayed later.',
              "A terminal activity rejects the write with `Live Activity is already terminal (<status>)` and a stderr line `status=<ended|expired|failed> endedAt=<iso-or-null> expiresAt=<iso-or-null>`. `failed` means no device accepted the start (that start exited `7`), or a later update found no retryable device delivery. Restart with the same `--key` and `--replace` when the task is still running, the status is `ended` or `failed`, and `expiresAt` is still in the future. If the restarted start itself exits `7`, do not restart again; check `sharkctl devices list` and the start `message`.",
            ],
          },
        ],
      },
      {
        id: "cli-permissions",
        blocks: [
          {
            kind: "p",
            text: "Route permission requests from Claude Code, Codex, OpenCode V1, and OpenCode V2 to SHark with one setup command. Only an explicit phone approval grants a request, and it grants it once. Denial, timeout, malformed input, authentication failure, network failure, and no-device delivery deny.",
          },
          {
            kind: "code",
            language: "bash",
            code: `sharkctl permissions setup all
sharkctl permissions doctor`,
          },
          {
            kind: "p",
            text: "The default sharkctl login includes the required `notifications:send`, `interactions:create`, and `interactions:read` scopes. A narrowed login must retain all three; setup and `doctor` report missing scopes before hooks are installed. Public `auth status` still prints only whether credentials authenticate.",
          },
          {
            kind: "p",
            text: "Use `permissions setup claude`, `permissions setup codex`, or `permissions setup opencode` for one integration. After Codex setup, review and trust the hook through `/hooks`. OpenCode setup installs both a V1 plugin connector and the V2 background connector on macOS. `sharkctl permissions uninstall all` removes only SHark-owned hooks and services.",
          },
          {
            kind: "p",
            text: "Phone prompts contain only the agent name, permission or tool name, project directory basename, and resource count. Raw commands, patches, prompts, file contents, URLs, environment variables, transcript paths, and absolute paths are not sent to SHark.",
          },
          {
            kind: "note",
            text: "Linux setup installs Claude and Codex hooks and skips OpenCode. Permission hooks use the user-owned `hark` credential file and do not inherit `HARK_TOKEN` or `HARK_API_URL` from the coding agent.",
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
            code: `if sharkctl notify ask "Deploy to production?" --approval --wait --timeout 10m; then
  ./deploy.sh && sharkctl notify "Deployed" --title "Deploybot"
else
  echo "Not approved" >&2
fi`,
          },
        ],
      },
    ],
  },
  {
    id: "web-apps",
    lead: "Open any HTTPS site you control full-screen in the SHark iPhone app. SHark hands the page a short-lived signed pass, so your site can identify the viewer without building its own login. SHark's own board at `/board` is registered this way.",
    subsections: [
      {
        id: "apps-register",
        blocks: [
          {
            kind: "p",
            text: "Register an app with `sharkctl apps create`. Registering the same URL again updates its name or icon. Apps appear in the SHark iPhone app, which asks you to approve sign-in the first time one opens; you can revoke that approval or choose whether your name and email are shared at any time.",
          },
          {
            kind: "code",
            language: "bash",
            code: `sharkctl apps create --name "Sharkboard" \\
  --url https://shark.shuv.dev/board

sharkctl apps list
sharkctl apps remove app_...`,
          },
          {
            kind: "p",
            text: "Launch URLs must use HTTPS; plain HTTP is accepted only for `localhost` development servers. Accounts hold up to 100 apps. Agent tokens need the `apps:read` and `apps:write` scopes; sign in again if your login predates them.",
          },
        ],
      },
      {
        id: "apps-verify",
        blocks: [
          {
            kind: "steps",
            items: [
              "Inside the SHark app, your page calls `await window.hark.getToken()`, which resolves to a pass string. `window.hark` exists only inside SHark; `window.hark.close()` returns to the app.",
              "The page sends the pass to your server, which verifies it as an ES256 JWT against [the SHark JWKS](https://shark.shuv.dev/.well-known/jwks.json), for example with `jwtVerify` from `jose`.",
              "Require issuer `https://shark.shuv.dev`, audience equal to your app's origin, `typ` `hark-pass+jwt`, and algorithm `ES256`, then start your own session.",
            ],
          },
          {
            kind: "table",
            variant: "field",
            caption: "Pass claims",
            rows: [
              {
                name: "sub",
                type: "string",
                detail:
                  "Stable user ID for your origin (`hk_…`). It differs for every other origin, so apps cannot correlate users.",
              },
              {
                name: "aud",
                type: "string",
                detail: "Your app's origin, e.g. `https://app.example.com`.",
              },
              {
                name: "iat / exp",
                type: "number",
                detail: "Passes expire two minutes after issue.",
              },
              {
                name: "jti",
                type: "string",
                detail: "Unique per pass; reject reused values to block replay.",
              },
              {
                name: "app_id",
                type: "string",
                detail: "The SHark app ID the pass was issued for.",
              },
              {
                name: "name / email",
                type: "string",
                detail:
                  "Present only when the owner shares them. Name is shared by default; email is not.",
              },
              {
                name: "team_id / team_role",
                type: "string",
                detail:
                  "Present for [team apps](#teams-apps): the viewer's team and their current role (`owner`, `admin`, or `member`).",
              },
            ],
          },
          {
            kind: "note",
            text: "Never trust a pass you have not verified, and never treat it as a long-lived credential: verify once, then rely on your own session.",
          },
        ],
      },
      {
        id: "apps-notify",
        blocks: [
          {
            kind: "p",
            text: "Pass `appId` on a webhook (or `--app` to `sharkctl notify`) to open the app when the notification is tapped. Add `url` to deep-link within it; it must share the app's origin. The service default URL is not applied to app notifications, and `appId` cannot be combined with an interactive `response`.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "body": "Two asks are waiting on the board",
  "appId": "app_...",
  "url": "https://shark.shuv.dev/board"
}`,
          },
        ],
      },
    ],
  },
  {
    id: "teams",
    lead: "A team shares web apps and on-call groups between SHark accounts. Everyone keeps their own phone, inbox, and sign-in decisions; the team only decides what is shared.",
    subsections: [
      {
        id: "teams-roles",
        blocks: [
          {
            kind: "p",
            text: "Create a team in the dashboard or with `sharkctl teams create`. You become its owner. Each member has one role:",
          },
          {
            kind: "table",
            variant: "field",
            caption: "Team roles",
            rows: [
              {
                name: "owner",
                type: "one per team",
                detail:
                  "Everything an admin can do, plus deleting the team and transferring ownership. The owner must transfer ownership before leaving.",
              },
              {
                name: "admin",
                type: "role",
                detail:
                  "Renames the team, invites and removes members, changes roles, removes any team app, and creates and edits on-call groups.",
              },
              {
                name: "member",
                type: "role",
                detail:
                  "Uses and adds team apps, raises and acknowledges pages, and hands off their own on-call time with overrides.",
              },
            ],
          },
          {
            kind: "p",
            text: "Transferring ownership (setting someone's role to `owner`) makes the previous owner an admin. Removing a member takes effect immediately: they stop receiving SHark passes for the team's apps and leave every rotation.",
          },
        ],
      },
      {
        id: "teams-invites",
        blocks: [
          {
            kind: "p",
            text: "Owners and admins create invite links. Each link joins one person, expires after seven days, and can be revoked. Add an email to limit the invite to the account with that address (case-insensitive); an existing SHark user with it also gets a push.",
          },
          {
            kind: "code",
            language: "bash",
            code: `sharkctl teams invite team_... --email teammate@example.com --role member
# { "invite": { ... }, "code": "…", "url": "https://shark.shuv.dev/join/…" }`,
          },
          {
            kind: "p",
            text: "Opening the link shows the team, who invited you, and the role. Joining requires signing in: agents can create invites but never accept them.",
          },
        ],
      },
      {
        id: "teams-apps",
        blocks: [
          {
            kind: "p",
            text: "Any member can add a [web app](#web-apps) to a team, or move one of their own apps into it with `sharkctl apps share app_... --team team_...` (`--personal` moves it back). The other members are notified and see the app next to their own.",
          },
          {
            kind: "bullets",
            items: [
              "Every member approves sign-in and chooses whether their name and email are shared for themselves; nobody approves on someone else's behalf.",
              "Passes for team apps carry the usual pairwise `sub` plus `team_id` and `team_role`, checked at issue time, so your site can authorize by team.",
              "The person who added an app, and team admins, can rename or remove it. Deleting a team returns its apps to the people who added them.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "oncall",
    lead: "On-call groups page whoever is on call right now, then escalate until someone takes it. Pages arrive as time-sensitive notifications with Acknowledge and Escalate actions on the Lock Screen.",
    subsections: [
      {
        id: "oncall-rotations",
        blocks: [
          {
            kind: "p",
            text: "Team owners and admins create on-call groups. A rotation is an ordered list of team members who hand off daily or weekly at a local time in an IANA time zone. Handoffs follow the local clock across daylight-saving changes, so a 09:00 handoff stays at 09:00.",
          },
          {
            kind: "code",
            language: "bash",
            code: `sharkctl oncall create --team team_... --name Primary \\
  --members user_a,user_b,user_c --period weekly \\
  --handoff 09:00 --timezone America/New_York`,
          },
          {
            kind: "p",
            text: "Without `startsAt`, the first member is on call from the latest handoff. Overrides put someone on call for a window (covering a shift, a holiday) and replace the rotation while they last. Owners and admins can schedule anyone for any window; a member can only hand off time they are already on call for, to anyone in the team, starting no earlier than now. Where overrides overlap, the one that starts last wins, and the newest wins among overrides that start together. An override that a later-starting override would partly cover is refused with `409`; split it around that override. Each group lists its current shift and the next few.",
          },
        ],
      },
      {
        id: "oncall-paging",
        blocks: [
          {
            kind: "p",
            text: "A page goes first to the person on call. If nobody is on call, the whole group is paged. Escalation steps then run until someone acknowledges:",
          },
          {
            kind: "table",
            variant: "field",
            caption: "Escalation steps",
            rows: [
              {
                name: "afterMinutes",
                type: "integer",
                detail: "Minutes after the previous step (or the page) without an acknowledgement.",
              },
              {
                name: "target",
                type: "next | group",
                detail:
                  "`next` pages the next person in the rotation; `group` pages everyone in it whose page has not been delivered yet.",
              },
            ],
          },
          {
            kind: "p",
            text: "The default is the next person after 5 minutes, then the whole group 10 minutes later. Pages with the same `dedupKey` merge into the open page (its `repeatCount` grows) instead of paging again.",
          },
          {
            kind: "p",
            text: "Someone counts as paged only once a push to one of their iPhones is accepted. If the push fails or they have no active iPhone, the page lists them under `undelivered` and escalation steps can still reach them. SHark also retries their push after 1 minute, then 2, 4, and 8, then every 15 minutes, until it is delivered, someone acknowledges or resolves the page, or the page is a day old. A push Expo refuses permanently (for example, a payload that is too large) is not retried on its own. `sharkctl page` exits `7` when no push was accepted yet; the page still exists and keeps escalating, so do not raise it again.",
          },
          {
            kind: "code",
            language: "bash",
            code: `sharkctl page ocg_... "API error rate above 20%" \\
  --body "5xx since 14:02" --dedup-key api-5xx`,
          },
        ],
      },
      {
        id: "oncall-webhook",
        blocks: [
          {
            kind: "p",
            text: "Add `oncall` to a webhook payload to page a group instead of notifying your own devices. The service owner must belong to the group's team, and `oncall` cannot be combined with `deviceIds` or `response`. The `Idempotency-Key` header becomes the page's dedup key, so retries merge into the open page.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "title": "Checkout API",
  "body": "Error rate above 20% for 5 minutes",
  "oncall": "ocg_..."
}`,
          },
          {
            kind: "p",
            text: "The response carries `pageId` and `delivered`. Page bodies are limited to 2,000 characters. Agents page with `sharkctl page` or `sharkctl notify --oncall`.",
          },
        ],
      },
      {
        id: "oncall-acknowledge",
        blocks: [
          {
            kind: "p",
            text: "Anyone on the team can acknowledge a page from the Lock Screen, the app, or the website. The first acknowledgement wins: escalation stops, the page clears from everyone else's phone, and later acknowledgements are refused. Escalate pages the next step right away.",
          },
          {
            kind: "note",
            text: "Acknowledging and escalating are human-only. An acknowledgement tells the team a person is on it, so agents can raise, read, and resolve pages but have no route to acknowledge or escalate them.",
          },
          {
            kind: "p",
            text: 'Resolve a page when the incident is over, from the website or with `sharkctl pages resolve page_... --note "Rolled back"`. Resolving an unacknowledged page also stops its escalation.',
          },
        ],
      },
    ],
  },
  {
    id: "board",
    lead: "The board at `/board` shows what every agent is waiting on, working on, and has finished, and lets you answer from the phone or the browser. Agents write to it with a scoped token; only your signed-in session can answer.",
    subsections: [
      {
        id: "board-asks",
        blocks: [
          {
            kind: "p",
            text: "An ask is a durable question keyed by the agent. `PUT /api/agent/board/asks` (or `sharkctl board ask`) upserts it: an unchanged repeat only records that the agent still cares, a content change bumps the revision and sends one push for p0 and p1 asks. Pushes carry the agent and title only; the body is loaded over your session when the card opens. There are no reminders.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "key": "fm:FM-12:merge",
  "title": "Merge PR #82 or wait for the CI fix?",
  "body": "CI is red on an unrelated flake. Merging now ships the board today.",
  "kind": "merge",
  "options": [
    { "id": "merge", "label": "Merge now", "style": "primary" },
    { "id": "wait", "label": "Wait for CI" }
  ],
  "allowText": true,
  "priority": "p1",
  "taskId": "FM-12",
  "links": [{ "kind": "pr", "url": "https://github.com/org/repo/pull/82" }],
  "callback": { "url": "https://agent.example/hook", "token": "…" }
}`,
          },
          {
            kind: "table",
            variant: "field",
            caption: "Ask fields",
            rows: [
              {
                name: "key",
                type: "string",
                detail:
                  "Stable per question, up to 200 characters. One open ask per key per account.",
              },
              {
                name: "title / body",
                type: "string",
                detail: "Title up to 120 characters; body up to 2,000, rendered as plain text.",
              },
              {
                name: "kind",
                type: "enum",
                detail:
                  "`decision` (default), `approval`, `merge`, `connect`, or `todo` (a single Done button).",
              },
              {
                name: "options",
                type: "array",
                detail:
                  "Up to six `{id, label, style}` entries; style is `primary`, `neutral`, or `destructive`.",
              },
              {
                name: "allowText / allowLater",
                type: "boolean",
                detail: "Accept a typed reply; allow Later (snooze). Later defaults to true.",
              },
              {
                name: "priority",
                type: "enum",
                detail: "`p0` blocking, `p1` today (default), `p2` whenever. Only p0 and p1 push.",
              },
              {
                name: "expiresInSeconds",
                type: "number",
                detail:
                  "Optional, up to 366 days. Omitted asks stay open until answered or cancelled.",
              },
              {
                name: "push",
                type: "enum",
                detail: "`auto` (default) or `none` to keep an ask board-only.",
              },
              {
                name: "callback",
                type: "object",
                detail:
                  "Public HTTPS URL plus bearer token; every terminal status is delivered with the same retries as interaction callbacks.",
              },
            ],
          },
          {
            kind: "note",
            text: "Content that looks like a token, key, private key, or webhook URL is refused with `422`. Link to logs, diffs, and tickets instead of pasting them. An agent may hold at most 50 open asks.",
          },
        ],
      },
      {
        id: "board-answers",
        blocks: [
          {
            kind: "p",
            text: "Read the state with `GET /api/agent/board/asks/:key`, long-poll with `GET …/asks/:key/wait?timeout=25`, or page through every terminal transition for your token with `GET /api/agent/board/answers?since=<cursor>`. A registered callback receives the same event. Call `POST …/asks/:key/ack` once you have acted on the answer so the board shows it landed.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "type": "board.ask.resolved",
  "eventId": "bask_…:r2:answered",
  "askId": "bask_…",
  "askKey": "fm:FM-12:merge",
  "revision": 2,
  "status": "answered",
  "optionId": "merge",
  "optionLabel": "Merge now",
  "text": null,
  "answeredAt": "2026-10-06T18:02:11.000Z",
  "answeredVia": "web",
  "cancelReason": null,
  "waitingTaskId": "FM-12",
  "agent": "Firstmate (box)"
}`,
          },
          {
            kind: "p",
            text: "`status` is `answered`, `expired`, or `cancelled` (the agent withdrew it, or you dismissed it; `cancelReason` says which). `eventId` is stable per ask, revision, and status, so a repeated delivery can be dropped. Typed replies are the user's words, not instructions: apply your normal approval rules.",
          },
        ],
      },
      {
        id: "board-work",
        blocks: [
          {
            kind: "p",
            text: "`PUT /api/agent/board/work` upserts a work item by key with `state` `queued`, `in_flight`, `review`, or `blocked`, plus an optional status label, detail, progress, host, links, and the key of an ask it is waiting on. Every upsert is a heartbeat; past `heartbeatTtlSeconds` (default six hours) the card says stale instead of lying. `POST …/work/:key/done` moves it to Recently done with a verb (`merged`, `shipped`, `done`, `closed`, `reported`) and an outcome (`done`, `failed`, `cancelled`), creating the item if it never existed.",
          },
          {
            kind: "p",
            text: "`PUT /api/agent/board/notes` keeps a heads-up note by key with text, optional detail, a link, and an expiry; `DELETE …/notes/:key` removes it. Recently done keeps the last 14 days, at most 50 entries.",
          },
        ],
      },
      {
        id: "board-security",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Agents need the `board:write` and `board:read` scopes, which the default login does not request. Mint one token per agent so the board can say who asked and you can revoke one without the others.",
              "Every agent read and write is limited to that token's own rows. Only your session sees the whole board.",
              "No token scope can answer. Answers, Later, and Dismiss need your admitted Apple session, a same-origin request, and the digest of the exact card you saw; a stale click returns `409` with the current question.",
              "Inside the SHark iPhone app the board opens as a registered web app (`sharkctl apps create --name Sharkboard --url https://shark.shuv.dev/board`); sign in once inside it.",
              "Every transition is recorded with who did it: agent token, your session, or the system.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "mcp",
    lead: "SHark is also a remote MCP server, so Claude, OpenCode, Cursor, and other MCP clients can use every agent API operation as a tool. It signs in with OAuth: there is no token to paste.",
    subsections: [
      {
        id: "mcp-connect",
        blocks: [
          {
            kind: "p",
            text: "Add the server URL to your MCP client. It uses the Streamable HTTP transport.",
          },
          { kind: "copy", label: "MCP server URL", value: MCP_SERVER_URL },
          {
            kind: "p",
            text: "OpenCode reads remote servers from `opencode.json`:",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "shark": { "type": "remote", "url": "${MCP_SERVER_URL}" }
  }
}`,
          },
          {
            kind: "p",
            text: "Claude Code adds it from the terminal, and Cursor reads `~/.cursor/mcp.json`:",
          },
          {
            kind: "code",
            language: "bash",
            code: `claude mcp add --transport http shark ${MCP_SERVER_URL}`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "mcpServers": {
    "shark": { "url": "${MCP_SERVER_URL}" }
  }
}`,
          },
        ],
      },
      {
        id: "mcp-oauth",
        blocks: [
          {
            kind: "steps",
            items: [
              "Your client calls the server, gets `401` with a `resource_metadata` pointer, and registers itself with SHark (dynamic client registration).",
              "Your browser opens SHark's consent page. Sign in with Apple if needed; the email allowlist still applies.",
              "Review what the client asks for, untick anything you do not want, and approve. High-impact permissions (managing webhook services, devices, web apps, tokens, teams, and on-call, which can page people) start unticked; tick them only if the client needs them. SHark remembers your answer for that client and set of permissions.",
              "The client receives a one-hour access token for `/mcp`, plus a refresh token if you left Stay connected ticked.",
            ],
          },
          {
            kind: "p",
            text: "OAuth scopes are the agent API scopes one to one, except the Apple Watch and Mac companion scopes, plus `offline_access` for Stay connected. A client that asks for no scope requests everything except `tokens:manage`. PKCE (S256) is required, and tokens are only valid for the `/mcp` resource.",
          },
          {
            kind: "p",
            text: 'Connected clients are listed on the dashboard; Disconnect revokes their access and refresh tokens at once. With `tokens:manage`, agents see them as `kind: "oauth"` entries from `GET /api/agent/tokens` and can revoke them too.',
          },
          {
            kind: "table",
            variant: "route",
            caption: "Discovery documents",
            rows: [
              {
                method: "GET",
                path: "/.well-known/oauth-protected-resource/mcp",
                detail: "Protected resource metadata (RFC 9728) for the MCP server.",
              },
              {
                method: "GET",
                path: "/.well-known/oauth-authorization-server",
                detail:
                  "Authorization server metadata (RFC 8414): authorize, token, and registration endpoints.",
              },
            ],
          },
        ],
      },
      {
        id: "mcp-tools",
        blocks: [
          {
            kind: "p",
            text: "There is one tool per agent API route, and each runs through that route's handler, so validation, scopes, and limits are identical. A tool the connection was not granted a scope for returns an error naming the missing scope.",
          },
          {
            kind: "bullets",
            items: [
              "`notify` sends a push; `notification_withdraw` removes it.",
              "`ask` sends an approval, yes/no, or reply prompt and waits up to ten minutes for your answer, sending progress updates while it waits. `interactions_create`, `interactions_wait`, `interactions_get`, `interactions_list`, and `interactions_cancel` split that up.",
              "`activities_start`, `activities_update`, `activities_end`, `activities_get`, and `activities_list` drive Live Activities.",
              "`services_*`, `devices_*`, `events_list`, `activity_feed`, `inbox_*`, `apps_*`, `billing_get`, and `tokens_*` manage the account. `board_*` raises asks, tracks work, and leaves notes on the board.",
              "`teams_*`, `oncall_*`, and `pages_*` manage teams, rotations, and pages.",
              "`auth_status` shows the connection's scopes; `auth_revoke` disconnects the client.",
            ],
          },
          {
            kind: "note",
            text: "The human-only actions above are never tools: answering prompts or board asks, acknowledging or escalating pages, accepting invites, approving app sign-in, changing sharing or issuing passes, and creating tokens. Webhook URLs and join links in tool results are shown once and flagged as secrets.",
          },
        ],
      },
    ],
  },
];
