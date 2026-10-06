# SHark Board Plan: upstream integration plus the multi-agent captain board

Status: ready for implementation. Written 2026-10-06 against SHark `main` at `900c93a` and upstream
Hark `main` at `a84813a` (fetched 2026-10-06). Supersedes the upstream half of
`PLAN-upstream-integration.md`, whose three pull requests have all landed (#38, #39, #40).
Re-fetch both remotes before starting and revise the SHAs if either has moved.

Nothing in this document exists yet unless it is explicitly cited as existing code.

## Goal

1. Bring the useful post-fork Hark work into SHark without merging `upstream/main`.
2. Add a durable, multi-agent captain board to SHark ("Sharkboard") that replaces shuvbro's
   tailnet-only live board, reachable on the phone and in the browser, answerable only by the
   captain, and fed by any agent holding a scoped token.

## Why not `git merge upstream/main`

A probe merge in a scratch worktree on 2026-10-06 produced 66 conflicted files out of 168 changed.
The two histories also disagree on migration `0019`: SHark production has applied
`0019_thin_black_cat`, while upstream has `0019_grey_millenium_guard` and `0020_simple_black_panther`.
Drizzle's journal cannot hold both, and a renamed migration would never run against production.
`docs/upstream-delta.md` and the previous plan already forbid a whole-branch merge for this reason.
Upstream work is therefore reimplemented selectively, as before.

### Upstream commits since the last integration

| Commit | Subject | Decision |
|---|---|---|
| `f743f61` | Project inbox and app customization | Skip. Large iOS rewrite of the inbox, alternate app icons, `project` table, read markers on `event`/`agent_notification`. SHark already has its own durable inbox projection. Revisit only if the board later wants per-project grouping. |
| `2647efe` | Fix contracts typecheck in CI | Skip. Contracts typecheck already exits zero here. |
| `c98ccfa` | Bump iOS version to 1.2 | Skip. SHark versions independently. |
| `8e14ede` | Web apps API with signed sign-in passes | **Port (Phase 1).** Gives any registered HTTPS page a full-screen slot in the iPhone app with a 120-second ES256 pass. This is the cleanest native-feeling iOS surface for the board. |
| `a84813a` | Apps as the iOS home, full-screen web view | **Port the web view and app list (Phase 1), not the home-screen swap.** SHark's iOS home and inbox-first routing stay as they are; apps become a tab/section. |

## Grounding: what SHark already has (read in code)

- `api_token` with `name`, hashed token, `scopes` JSON, `expiresAt`, `lastUsedAt`, `revokedAt`;
  device authorization mints 90-day tokens after the captain approves in the browser.
- `requireAuth` (Apple session plus email allowlist), `requireApiToken`, `requireScopes` in
  `apps/website/src/server/middleware.ts`.
- Fourteen token scopes in `packages/contracts/src/index.ts` `API_TOKEN_SCOPES`; none grants a
  board answer. `sharkctl` `DEFAULT_SCOPES` includes no `*:respond` scope.
- `interaction` rows with idempotency, `actionDigest`, callbacks, and five respond paths that all
  call `deliverInteractionCallbacks()` (`routes/interactions.ts` three times, `routes/watch.ts`,
  `routes/macos.ts`). The callback worker in `lib/interaction-callbacks.ts` retries at
  0s, 30s, 2m, 10m, 1h with a 30-second sweep.
- The durable inbox projection `inbox_item` / `inbox_item_event` rebuilt by `syncInboxForUser()`.
- `isSameOrigin()` exists twice, in `routes/devices.ts` and `routes/web-push.ts`.
- Partial unique indexes already generate correctly: `live_activity` uses
  `uniqueIndex().where(sql\`...\`)` in `db/schema.ts`.
- `db/contract.ts` pins `EXPECTED_MIGRATION_COUNT = 20`, the latest migration timestamp, and a
  `REQUIRED_TABLES` subset (fourteen tables, not all of them). The deploy helper checks these.
- No server-sent events anywhere in the server.
- The web dashboard (`client/pages/Dashboard.tsx`, `InboxPanel.tsx`) cannot answer interactions.
- `jose` is already a website dependency.
- Expo app routes: `home`, `inbox`, `inbox-detail`, `notification-detail`, `settings`, `la-lab`.
  Push taps resolve through `inboxIdFromNotificationData()` in `apps/expo/src/lib/inbox.ts`.
- `sharkctl` is one file, `packages/sharkctl/src/cli.mjs` (verbs: `auth`, `notify`, `notify ask`,
  `devices`, `services`, `activity`, `permissions`), with `client.mjs` exported as
  `sharkctl/client`. Exit codes 0 to 7 are a published contract.

### What the shuvbro board does today (read in `~/repos/shuvbro`)

- `bin/fm-board.sh model` emits one `fm-board.v1` JSON document with lanes `waiting_on_you`,
  `with_lead`, `in_flight`, `queued`, `done`, `fyi`, plus a sha256 card digest per answerable item.
- Answers go through `fm-captain-hold.sh answers --source <provenance>` (the single keyed-answer
  intake), then `fm-inbox.sh note` wakes the lead. Yes releases a hold; any other choice or a typed
  reply is recorded and the hold stays; Later records a date.
- Holds carry up to six `--option` labels of 120 bytes each.
- Workers are barred from `sharkctl notify` and `sharkctl ask` by the PATH shim
  `bin/fm-sharkctl-guard.sh` while `FM_TASK_ID` is set.
- Exposure is loopback plus Tailscale Serve on shuvdev port 10006, with host and login allowlists.

## Design summary

- **Durability lives in new fork-only tables**, never in `interaction`. An ask persists until
  answered, cancelled, or its optional expiry; the push for it is an ordinary short-lived
  `interaction` or `agent_notification`.
- **Identity is the token.** Every board row records `requester_token_id` and a snapshot of
  `api_token.name`. One token per agent (`--client-name "Bro (shuvdev)"`), so Bro and Hermes stop
  sharing a host token.
- **Answers come only from the captain's surfaces:** an Apple web session (same-origin POST), the
  iOS app's device-bound respond paths, or an iOS web-view pass minted by that same session.
  **No token scope can answer.** Two new scopes, `board:write` and `board:read`, are both limited to
  the caller's own rows.
- **One push per ask revision.** Re-asserting unchanged content sends nothing. Changed content
  bumps `revision`, re-pins the digest, cancels the stale push, and sends one new push. No reminders.
- **Callbacks fire on every terminal status** (`answered`, `expired`, `cancelled`), unlike
  interaction callbacks, using a copy of the existing retry worker.
- **Web board first, native second.** `/board` in the existing SPA ships through the normal
  pipeline. Phase 1 ports upstream web apps so the same page opens full screen inside the iPhone app.
- **Keep the fork diff narrow.** New code in new files; upstream-touching edits limited to the
  scope list, route mounts, `REQUIRED_TABLES`, one line in each respond handler, one SPA route, one
  worker start, and `docs/upstream-delta.md`.

## Phase 0: baseline and hygiene (0.25 day)

1. Create a feature branch from `main`. Leave the uncommitted `AGENTS.md` change to its owner.
2. Confirm the toolchain and gates pass on `main` before any change:
   ```sh
   pnpm install --frozen-lockfile
   pnpm typecheck && pnpm test && pnpm lint && pnpm brand:check
   ```
3. Add a dated "Upstream review 2026-10-06" entry to `docs/upstream-delta.md` recording the
   decisions in the table above and the merge-probe numbers.

## Phase 1: port upstream web apps and signed passes (2 to 2.5 days)

Reference commits: `8e14ede` (server, contracts, CLI) and `a84813a` (iOS). Reimplement against
current SHark files; do not cherry-pick.

### 1.1 Contracts (`packages/contracts/src/index.ts`, tests)

- Add `appUrlSchema` (HTTPS, or HTTP on loopback only), `appOrigin()`, `appIdSchema`
  (`app_` prefix), `appNameSchema`, `appCreateSchema`, `appSharingSchema`, `appLaunchSchema`,
  `AppSummaryDto`, `AppDto`, `AppCreateResponse`, `AppPassResponse`, `AppPassClaims`,
  `MAX_APPS_PER_ACCOUNT = 100`, `API_ERROR_CODE_CONSENT_REQUIRED`, `APP_PASS_TTL_SECONDS = 120`,
  `APP_PASS_JWT_TYPE = "hark-pass+jwt"`, `APP_PASS_ALGORITHM = "ES256"`,
  `APP_PASS_JWKS_PATH = "/.well-known/jwks.json"`. Keep the `hark-pass+jwt` type and `app_` prefix
  verbatim: they are protocol identifiers under the compatibility rule.
- Add scopes `apps:read`, `apps:write`.
- Add optional `appId` to the agent notification schema, webhook payload schema, inbox
  notification DTO, and push data schema. Omit `project` from `appCreateSchema` (SHark has no
  `project` table).

### 1.2 Server

- `db/schema.ts`: `app` and `app_signing_key` tables exactly as upstream minus `project_id`;
  nullable `app_id` on `event` and `agent_notification`. Fence the section with a
  "SHark upstream port: web apps" comment.
- Migration `0020_*` generated with `pnpm --filter @hark/website db:generate`. Bump
  `EXPECTED_MIGRATION_COUNT`, `EXPECTED_MIGRATION_CREATED_AT`, `KNOWN_MIGRATION_CREATED_AT`, and
  add `app`, `app_signing_key` to `REQUIRED_TABLES` in `db/contract.ts`. Extend
  `db/migrate.test.ts` for the new migration the way upstream did.
- `lib/token.ts`: add the `app-signing-key` encryption purpose and
  `encryptAppSigningKey` / `decryptAppSigningKey`.
- New `lib/app-pass.ts` (key generation on first use, `issueAppPass`, `publicJwks`) and
  `lib/apps.ts` (`toAppDto`, `ownedAppDto`, `selectAppsWithJoins`, `resolveNotificationApp`).
  Issuer is `env.APP_URL` origin; audience is the app origin; subject is pairwise per origin.
- New `routes/apps.ts`: `appsAgentRoute` (`GET/POST /api/agent/apps`, `DELETE /:id`),
  `appsSessionRoute` (`GET /api/apps`, `GET/PATCH/DELETE /:id`, `POST /:id/pass` with consent gate
  and 30 passes per minute per user, `POST /:id/revoke`), and `appPassJwksRoute` at the site root.
  Mount in `app.ts`. The JWKS route is the one new anonymous path; add it to the "Only
  `/api/health` is anonymously readable" bullet in `docs/upstream-delta.md`.
- `routes/interactions.ts` notifications handler and `routes/hooks.ts`: accept `appId`, require it
  to be the caller's own app, require any `url` to share the app origin, skip the service default
  tap URL when an app is set. `routes/inbox.ts` and `lib/inbox.ts`: join the app summary.
- Tests: route tests in `routes/apps.test.ts` covering create/upsert, cap, consent 409, pass
  verification with `jose` against the served JWKS (iss, aud, typ, sub, exp), sharing toggles,
  revoke, cross-user and cross-origin rejection, rate limit, and delete. Hooks and interactions
  tests gain `appId` cases.

### 1.3 sharkctl

- `apps create --name --url [--icon] [--json]`, `apps list [--json]`, `apps remove <id>`,
  `notify --app <id>`. Add `apps:read`, `apps:write` to `DEFAULT_SCOPES` with the same 403
  re-login hint upstream added. Update `README.md`, `skills/shark/SKILL.md`, and the in-app docs
  (`apps/website/src/shared/docs/content.ts`, `nav.ts`, `docs.test.ts`).

### 1.4 iOS (Expo)

- Port `src/lib/web-apps.ts` (bridge script, origin checks, message parsing) with its tests,
  `src/components/app-icon.tsx`, `app/web/[id].tsx` (full-screen WebView, `window.hark.getToken()`
  and `close()`, two-finger-hold menu, origin-gated token delivery, external-link prompt),
  `app/apps/index.tsx` and `app/apps/[id].tsx` (list, consent, sharing, revoke, remove).
- Do **not** make apps the home. Add an "Apps" entry from the existing `home` screen and keep
  inbox-first tap routing. Push taps carrying `appId` open the app; otherwise unchanged.
- Add `react-native-webview`. Do not switch fonts.
- Gates: `pnpm --filter @hark/expo typecheck`, `pnpm --filter @hark/expo test`, a dev build on the
  simulator against a local test page, then an EAS build and physical-device check per
  `docs/verification.md` before TestFlight.

### 1.5 Validate Phase 1

```sh
pnpm --filter @hark/contracts test
pnpm --filter @hark/website test -- src/server/routes/apps.test.ts
pnpm --filter @hark/website test -- src/server/db/migrate.test.ts
pnpm --filter sharkctl test && pnpm --filter sharkctl build
pnpm typecheck && pnpm test && pnpm lint && pnpm brand:check && pnpm build
```

Phase 1 can be released on its own before the board. It is also the only phase with an iOS
build, so the board phases are not blocked on TestFlight.

## Phase 2: board contracts and data model (0.75 day)

### 2.1 Contracts: new file `packages/contracts/src/board.ts`, re-exported from `index.ts`

- Scopes `board:write`, `board:read` added to `API_TOKEN_SCOPES`.
- `boardAskUpsertSchema`: `key` (≤200), `title` (≤120), `body` (≤2000, plain text), `kind`
  (`decision | approval | merge | connect | todo`), `options` (0 to 6 of `{id, label ≤120,
  style: primary | neutral | destructive}`), `allowText`, `allowLater`, `priority`
  (`p0 | p1 | p2`), `taskId` (≤100), `agentDisplay` (≤60), `links` (≤10 of `{kind, url https,
  label}`), `expiresInSeconds` (nullable, ≤ 366 days), `push` (`auto | none`), `quick`
  (`yes_no | approval`, only with exactly two options), `callback {url, token}` reusing the
  webhook callback shape (public HTTPS, token 16 to 512 chars).
- `boardWorkUpsertSchema`: `key`, `title`, `state` (`queued | in_flight | review | blocked`),
  `statusLabel` ≤60, `detail` ≤240, `progress` 0..1, `links`, `host` ≤60, `waitingAskKey`,
  `heartbeatTtlSeconds` (default 21,600).
- `boardDoneSchema`: `key`, `title?`, `verb` (`merged | shipped | done | closed | reported`),
  `links`, `note` ≤600.
- `boardNoteUpsertSchema`: `key`, `text` ≤300, `detail` ≤2000, `link`, `expiresInSeconds`.
- Session answer schemas: `boardAnswerSchema {digest, optionId? | text?}`,
  `boardSnoozeSchema {digest, until}`, `boardDismissSchema {digest, reason?}`.
- DTOs: `BoardAskDto`, `BoardWorkItemDto`, `BoardNoteDto`, `BoardCrewEntryDto`, `BoardPageDto`
  (lanes plus `cursor`), `BoardAnswerEventDto`, the callback payload type
  `board.ask.resolved`.
- A `boardSecretPatterns` export and `findBoardSecret(text)` helper shared by server and CLI:
  `hark_` tokens, `ghp_`/`github_pat_`, `sk-`, `xox[abp]-`, `AKIA`, PEM private key headers,
  `Bearer <long>`, the SHark `/hooks/` URL, and long high-entropy runs.

### 2.2 Tables (fork-only section at the end of `db/schema.ts`)

`board_ask`

| column | notes |
|---|---|
| `id` | `bask_` via `newId` |
| `user_id` | FK user, cascade |
| `requester_token_id` | FK api_token, set null |
| `agent_label` | snapshot of `api_token.name` |
| `agent_display` | self-declared, display only |
| `ask_key` | partial unique `(user_id, ask_key) where status = 'open'` |
| `revision` | int |
| `title`, `body`, `kind`, `options` json, `allow_text`, `allow_later`, `priority`, `waiting_task_id`, `links` json | |
| `status` | `open | answered | expired | cancelled` |
| `snooze_until`, `expires_at` (nullable) | |
| `answer_option_id`, `answer_text`, `answered_at`, `answered_via` (`web | ios_app | ios_lock_screen | ios_webview | external`), `answered_by_device_id`, `answered_session_hash` | |
| `cancel_reason` | |
| `action_digest` | sha256 over `{id, revision, title, body, options, allow_text, kind}` |
| `push_interaction_id`, `push_notification_id` | nullable FKs to the current revision's push |
| `callback_url`, `callback_token_ciphertext`, `callback_status`, `callback_attempts`, `callback_next_attempt_at`, `callback_last_error`, `callback_delivered_at` | same semantics as `interaction` |
| `last_asserted_at`, `acked_at`, `created_at`, `updated_at` | |

`board_ask_event`: `id`, `ask_id`, `dedupe_key` (unique per ask), `kind` (`opened | reasserted |
revised | pushed | push_failed | answered | snoozed | expired | cancelled | callback_delivered |
callback_failed | acked`), `actor_type` (`token | session | device_credential | system`),
`actor_ref`, `revision`, `detail` ≤500, `occurred_at`.

`board_work_item`: `id`, `user_id`, `requester_token_id`, `agent_label`, `agent_display`,
`work_key` (unique per user), `title`, `state` (`queued | in_flight | review | blocked | done |
failed | cancelled`), `status_label`, `detail`, `progress`, `links`, `host`, `waiting_ask_id`,
`started_at`, `last_heartbeat_at`, `heartbeat_ttl_seconds`, `completed_at`, `completion_verb`,
`note`, `live_activity_id`, timestamps.

`board_note`: `id`, `user_id`, `requester_token_id`, `agent_label`, `note_key` (unique per user),
`text`, `detail`, `link`, `expires_at`, timestamps.

Migration `0021_*` adds the four tables. Bump `db/contract.ts` and `REQUIRED_TABLES` again.
Indexes: `(user_id, status, priority, created_at)` on asks, `(callback_status,
callback_next_attempt_at)`, `(user_id, state, completed_at)` on work items, `(user_id)` on notes.

## Phase 3: server core (1.5 days)

New files: `lib/board.ts`, `lib/board-push.ts`, `lib/board-callbacks.ts`, `lib/board-stream.ts`,
`lib/same-origin.ts`, `routes/board-agent.ts`, `routes/board-session.ts`, and tests beside each.

### 3.1 `lib/same-origin.ts`

Lift `isSameOrigin()` out of `routes/devices.ts` and `routes/web-push.ts` into one helper and use
it from all three places.

### 3.2 `lib/board.ts`

- `upsertAsk(token, input)`: find the open ask by `(user_id, ask_key)`; compute the content hash
  over user-visible fields. Unchanged → bump `last_asserted_at`, append `reasserted`, return the row
  with `changed: false`. Changed → `revision + 1`, new digest, append `revised`, cancel the stale
  push, schedule the new push. New → insert, append `opened`, schedule push. Enforce 50 open asks
  per token (409 past the cap) and reject secrets with 422 using `findBoardSecret`.
- `cancelAsk`, `ackAsk`, `upsertWork` (heartbeat on every call), `markDone` (upsert straight into
  `done` when no row exists), `upsertNote`, `clearNote`.
- `answerAsk(ask, {digest, optionId?, text?, via, actor})`: 409 on digest mismatch or non-open
  status; validate the option against the current revision; write the answer, append `answered`,
  cancel the linked pending interaction (same update `POST /interactions/:id/cancel` performs,
  then `resolveInteractionLiveActivity`), enqueue the callback, and notify the stream.
- `snoozeAsk`, `dismissAsk` (status `cancelled`, `cancel_reason`, actor session).
- `sweepExpiredAsks()` and `sweepStaleWork()` run every 60 seconds from `index.ts`.
- `boardPageForUser(userId)` assembles the lanes:
  1. Waiting on you: open, not snoozed, p0 → p1 → p2, oldest first; asks older than 14 days flagged
     `aged`.
  2. Answered with agent: `answered` and `acked_at is null`, with callback status.
  3. In flight: `in_flight | review | blocked`, with `stale` when past the heartbeat TTL.
  4. Queued.
  5. Heads-up: notes not expired.
  6. Recently done: `done | failed | cancelled` work items from the last 14 days, max 50, merged
     with answered asks.
  7. Crew: one entry per token that has written a board row, with `api_token.lastUsedAt`, open ask
     count, in-flight count.

### 3.3 `lib/board-push.ts`

Per revision, choose the push:

- two options with `quick: yes_no | approval` → `interaction` of that kind with the option mapping
  stored in the ask (`yes → opt-1`), `Idempotency-Key: bask:<id>:r<rev>`, default 24-hour expiry;
- text-only ask that is not `approval | merge | connect` → `interaction kind=reply`;
- anything else → `agent_notification` with `url = <APP_URL>/board/ask/<id>` and, after Phase 1,
  `appId` of the registered board app so the iPhone opens the board web view directly;
- `push: none` or priority `p2` → no push, board only.

The push carries **title and agent label only, never the body.** Reuse the existing create paths
by calling the same internal functions `routes/interactions.ts` uses (extract them if they are
inline today) so analytics, abuse limits, and inbox projection behave identically.

### 3.4 Respond hooks

Add `void resolveBoardAskFromInteraction(row)` next to each `deliverInteractionCallbacks()` call
in the five respond handlers. It resolves the ask only when `push_interaction_id = row.id`, the ask
is `open`, the revision matches, and the path is a captain surface (session plus device, or
per-push response token). Answers through `watch:respond` or `macos:respond` do **not** resolve the
ask; they append an event `answered_elsewhere` so the card can show "answered on watch, confirm on
board". Record `respondingDeviceId` where the existing paths leave it null for ask-linked rows.

### 3.5 `lib/board-callbacks.ts`

Copy of the interaction worker: same `RETRY_DELAYS_MS`, `redirect: "manual"`, 10-second timeout,
`Hark-Callbacks/1` user agent, 30-second sweep started from `index.ts`. Selects asks with
`status in (answered, expired, cancelled)` and a pending callback. Payload:

```json
{
  "type": "board.ask.resolved",
  "eventId": "<board_ask_event.id>",
  "askId": "bask_…",
  "askKey": "fm:FM-X:pick",
  "revision": 3,
  "status": "answered",
  "optionId": "opt-2",
  "optionLabel": "Hold",
  "text": null,
  "answeredAt": "…",
  "answeredVia": "web",
  "waitingTaskId": "FM-X",
  "agent": "Firstmate (grok box)"
}
```

### 3.6 `lib/board-stream.ts`

In-process per-user emitter. `GET /api/board/stream` uses Hono's `streamSSE` and emits only
`changed {cursor}`; the page re-fetches `GET /api/board`. A 25-second keepalive comment keeps
proxies from idling the connection.

### 3.7 Routes

`routes/board-agent.ts`, mounted at `/api/agent/board`, `requireApiToken`, every query filtered by
`requester_token_id = token.id`:

| Method and path | Scope | Purpose |
|---|---|---|
| `PUT /asks` | `board:write` | upsert by key; returns `{ask, changed, pushed}` |
| `POST /asks/:key/cancel` | `board:write` | cancel with reason |
| `POST /asks/:key/ack` | `board:write` | agent applied the answer |
| `GET /asks/:key` | `board:read` | current state |
| `GET /asks/:key/wait?timeout≤25` | `board:read` | long-poll until terminal, like `/interactions/:id/wait` |
| `GET /answers?since=<cursor>` | `board:read` | terminal events for this token, oldest first, max 100 |
| `PUT /work` | `board:write` | upsert plus heartbeat |
| `POST /work/:key/done` | `board:write` | complete |
| `PUT /notes`, `DELETE /notes/:key` | `board:write` | heads-up notes |

`routes/board-session.ts`, mounted at `/api/board`, `requireAuth` plus `isSameOrigin` on every
POST:

| Method and path | Purpose |
|---|---|
| `GET /` | `BoardPageDto` for the signed-in captain |
| `GET /asks/:id` | one ask with its event timeline |
| `POST /asks/:id/answer` | `{digest, optionId? | text?}`; records `answered_session_hash` |
| `POST /asks/:id/snooze` | `{digest, until}` |
| `POST /asks/:id/dismiss` | `{digest, reason?}` |
| `GET /stream` | server-sent events |

No step-up. An admitted Apple session plus same origin plus the current digest is sufficient for
every answer kind (decided 2026-10-06; this is a personal project).

### 3.8 Pass-authenticated board access (after Phase 1)

Allow the board session routes to accept `Authorization: Bearer <pass>` as an alternative to the
cookie when the pass verifies against the server's own JWKS with `aud = APP_URL origin` and the
pairwise subject maps to the user. This is what the iPhone web view presents; it is minted only by
`POST /api/apps/:id/pass` under `requireAuth`, so it remains a captain surface. Record
`answered_via = ios_webview`.

### 3.9 Tests

Route tests with the in-memory SQLite harness used by `routes/inbox.test.ts`: upsert idempotency
and revision bump, push selection per shape, 409 on stale digest, cap at 50, 422 on secrets,
ownership isolation between tokens, every answer surface and the two that must not resolve an
ask, snooze and dismiss, expiry sweep, callback delivery and retry schedule with a fake fetch,
`answers?since` cursor paging, long-poll timeout, SSE emits on change.

## Phase 4: web board (1.5 days)

- `client/pages/Board.tsx` plus `client/components/board/*` (AskCard, WorkCard, NoteCard,
  CrewStrip, LaneHeader, LaterPicker, ReplyBox). Routes `/board` and `/board/ask/:id` in
  `App.tsx`. Session gate identical to the dashboard.
- Phone-first single column at 390 px, two columns at 1280 px, dark and light via the existing
  Tailwind setup. Large touch targets. Tab title shows the waiting count.
- Live updates: `EventSource` on `/api/board/stream` with a 15-second polling fallback and refresh
  on `visibilitychange`.
- Card actions: option buttons (styled by `style`), Reply, Later (date picker), Dismiss (with
  optional reason), each sending the card's `digest`. On 409 the card reloads and shows "This
  question changed". Delivery status chip on answered cards: delivered, retrying, failed, or
  "agent polled at …" (from `acked_at` and `last_asserted_at`).
- Agent bodies render as text only, never HTML, labelled "from <agent>".
- When `window.hark` exists (iPhone web view), fetch a pass with `getToken()` and send it as the
  bearer header; otherwise use the cookie. Hide the SPA chrome in that mode.
- Add `api.board.*` helpers to `client/lib/api.ts`. Vitest component tests like
  `InboxPanel.test.tsx` for lane ordering and stale-digest handling. QA
  screenshots at 390 and 1280 recorded in `docs/verification.md`.

## Phase 5: sharkctl `board` verbs (0.75 day)

New `packages/sharkctl/src/board.mjs`, dispatched from `cli.mjs`; helpers added to `client.mjs`.

```
sharkctl board ask   --key K --title T [--body-file F | --stdin] [--option LABEL]... [--quick yes_no|approval]
                     [--text] [--later] [--kind decision|approval|merge|connect|todo] [--priority p0|p1|p2]
                     [--task ID] [--agent NAME] [--link kind=URL]... [--expires-in D] [--push auto|none]
                     [--callback-url-env VAR --callback-token-file F] [--wait [--timeout D]]
sharkctl board cancel --key K [--reason TEXT]
sharkctl board get    --key K
sharkctl board wait   --key K [--timeout D]
sharkctl board answers [--since CURSOR] [--json]
sharkctl board ack    --key K
sharkctl board work   --key K --title T --state queued|in_flight|review|blocked [--status S] [--detail D]
                     [--progress P] [--host H] [--link kind=URL]... [--waiting-ask K]
sharkctl board done   --key K [--title T] --verb merged|shipped|done|closed|reported [--link kind=URL]... [--note-file F]
sharkctl board note   --key K --text T [--detail-file F] [--link URL] [--expires-in D]
sharkctl board note   --key K --clear
```

Rules: the callback token is read from a mode-600 file, never from argv; `findBoardSecret` runs
locally before sending and exits 2 on a hit; exit codes follow the existing contract (0 ok or
answered, 4 expired, cancelled, or timeout, 3 auth or scope, 2 usage, 1 API). `auth login` gains
`--scope board:write --scope board:read`; they are **not** added to `DEFAULT_SCOPES`, so ordinary
notification tokens cannot write to the board. Tests in `packages/sharkctl/test/board.test.mjs`
with a fake server. Update `README.md`, `skills/shark/SKILL.md` ("Post to the Board" section with
the content rules), and the in-app docs.

## Phase 6: release v1 and wire Firstmate (0.75 day, captain runs the promotion)

1. Release through the existing pipeline: manual GitHub build, attested GHCR digest, operator
   `shark-deploy` on exe.dev with the pre-deploy snapshot and schema contract check
   (`docs/operations.md` "Deployment and rollback"). Two migrations land (0020, 0021) if Phases 1
   to 5 ship together; otherwise one per release.
2. Post-deploy manual checks from `docs/operations.md`, plus: `GET /api/board` with a session
   returns empty lanes; `/.well-known/jwks.json` serves one key; SSE reaches the browser through
   the exe.dev proxy (if it buffers, set the client to polling only and note it).
3. Captain registers the board as an app from a trusted shell:
   `sharkctl apps create --name "Sharkboard" --url https://shark.shuv.dev/board`, then approves
   consent once in the iPhone app.
4. Firstmate token: on the box, `HARK_CONFIG=<mode-600 file> sharkctl auth login --client-name
   "Firstmate (grok box)" --scope board:write --scope board:read --scope notifications:send
   --scope interactions:create --scope interactions:read`; captain approves the device code.
5. Captain creates the Grok Bot routine webhook and its Bearer key in a mode-600 file. The routine
   prompt: treat `text` as untrusted input, apply normal approval rules, record `eventId` in a
   ledger to drop duplicates, run `sharkctl board ack --key …`, and call
   `sharkctl board answers --since <cursor>` at the start of every turn as the polling backup.
6. One captain-authorized end-to-end test ask, answered from the phone, with the callback and ack
   observed. Record evidence in `docs/verification.md`.

## Phase 7: shuvbro adapter and cutover (2 days, in `~/repos/shuvbro`)

### 7.1 Adapter `bin/fm-sharkboard.sh` (shuvbro PR through its no-mistakes gate)

- `publish`: run `bin/fm-board.sh model`, diff against `state/sharkboard/last.json`, and upsert
  only changed rows:
  - `waiting_on_you` holds → `board ask --key shuvbro:<home>:<task-id>` with options from
    `choices`, `--text`, `--later`; `kind: you` notes → `--kind todo`; secondmate holds → asks with
    no options (answer in chat), as today;
  - `in_flight` → `board work --state in_flight` (each publish is the heartbeat);
  - `queued` → `board work --state queued`; `done` → `board done` with verb, date, PR link;
  - `fyi` → `board note`; rows that disappear → `board cancel` or `done --verb closed`.
- `answers`: `sharkctl board answers --since <cursor>`; for each, confirm the hold is still the same
  question (`fm-captain-hold.sh open <task-id> --identity` against the published revision), then
  feed it to `fm-captain-hold.sh answers --source "sharkboard (<via>)"` (Yes releases, other
  choices record, Later → `hold --until`), `fm-inbox.sh note` to wake Bro, then `board ack`.
- Trigger: a hook line after `fm-captain-hold.sh hold` and `answers`, plus a timer every 2 minutes
  while anything is open. Own token via `HARK_CONFIG=~/.config/shark-board/bro.json`,
  `--client-name "Bro (shuvdev)"`.
- Extend `bin/fm-sharkctl-guard.sh` to refuse `board ask`, `board note`, `board done` under
  `FM_TASK_ID` (allow `board work` heartbeats only if wanted).
- Tests beside the existing `tests/fm-board.test.sh` fixtures.

### 7.2 Cutover

The shuvbro board is a day old. Once the adapter publishes and answers round-trip, stop the
shuvbro board (`systemctl --user disable --now shuvbro-board.service`, `tailscale serve
--https=10006 off` on shuvdev) and keep `bin/fm-board.sh model` as the adapter's export. No
dual-write period. `OPEN.md` on the box becomes a pointer to the board; Firstmate re-creates
whatever is still open as asks and work items.

## Phase 8: optional follow-ups

- **Native iOS card (2 to 3 days):** `askId` in push data, `inboxIdFromNotificationData` returns
  `ibox:board_ask:<id>`, project open asks into `inbox_item` with `needsAction` so the app badge
  counts them (check older builds tolerate an unknown inbox kind first), and a native card or the
  Phase 1 web view opened directly.
- **Live Activity for p0 binary asks:** `presentation=live_activity` within the existing 8-hour,
  one-per-device limits.
- **`sharkd` board poller:** teach the broker to poll `answers` with per-agent local hooks once it
  supports more than shuvcode and Codex.

## Security

- SHark is a public origin; everything except `/api/health` and the new JWKS needs a session or a
  scoped token. Push content also transits Expo, Apple, and web push providers, so pushes carry
  title and agent only.
- Allowed on the board: short titles, decision summaries, task ids, agent names, option labels,
  repo, PR, Linear, and GitHub URLs, the captain's short answers, status labels, progress.
  Links only, never inline: fleet notes, logs, diffs, transcripts, file contents, customer or
  ticket details. Never: secrets, tokens, webhook URLs, OAuth codes, private keys, env values,
  session ids. Enforced server-side (422) and in `sharkctl` before sending.
- Agents cannot answer: no `board:respond` scope exists; agent queries are filtered by their own
  token id; the web answer route needs an admitted Apple session plus same origin plus the current
  digest; the iOS paths need a registered device or a per-push response token; the pass path needs
  a pass minted under `requireAuth`. Watch and Mac token answers do not resolve asks in v1.
- Every transition writes a `board_ask_event` with actor type and reference; the card shows where
  the answer came from.
- Per-token cap of 50 open asks, existing per-account abuse limits, pass rate limit of 30 per
  minute per user.
- Never approve a device-code request asking for `*:respond` unless it is the captain's own Mac or
  Watch app. Never sign into `shark.shuv.dev` in the shared box browser.

## Keeping the fork diff manageable

- New files for everything listed above; `schema.ts` additions in two fenced sections ("upstream
  port: web apps", "SHark board, fork-only").
- Upstream-touching edits: `API_TOKEN_SCOPES` (+4), `app.ts` mounts, `db/contract.ts`, five
  one-line respond hooks, one `App.tsx` route, two worker starts in `index.ts`, `isSameOrigin`
  extraction, `docs/upstream-delta.md`.
- Migration journal rule for the next upstream import: import upstream migrations first, then
  regenerate the fork's board migration on top. Board tables never alter upstream tables.
- Record both the apps port and the board as bullets in `docs/upstream-delta.md`.

## Estimate

| Phase | Days |
|---|---|
| 0 Baseline | 0.25 |
| 1 Upstream web apps and passes (server, CLI, iOS) | 2 to 2.5 |
| 2 Board contracts and tables | 0.75 |
| 3 Server core | 1.5 |
| 4 Web board | 1.5 |
| 5 sharkctl verbs | 0.75 |
| 6 Release and Firstmate wiring | 0.75 |
| 7 shuvbro adapter and cutover | 1.5 |
| **Total** | **9 to 9.5 agent-days** |
| 8 Optional (native card) | 2 to 3 |

Minimum useful slice, if Phase 1 is deferred: Phases 0, 2, 3, 4, 5, 6 at about 5.5 days, with
push taps opening the board in Safari via the inbox detail's URL button.

## Decisions (recorded 2026-10-06)

1. Port upstream web apps and passes first (Phase 1). Yes.
2. Short titles, option labels, and links may live on SHark behind the existing auth gates; pushes
   carry title and agent only. Yes.
3. One push per revision for p0 and p1, p2 board-only, no reminders. Yes.
4. No fresh-session or passkey step-up for any answer kind. Keep it simple.
5. No dual-write or staged retirement for the shuvbro board; switch over once the adapter works.
6. One token per agent via device-code approval. Yes.

## Open technical questions (no captain input needed)

- Does the exe.dev HTTPS proxy pass `text/event-stream` unbuffered? Verify in Phase 6; fall back to
  polling if not.
- Which internal functions in `routes/interactions.ts` can be reused for board pushes without
  duplicating the notification create path; extract if they are inline.
- Whether older iOS builds tolerate an unknown `InboxItemKind` (only matters for Phase 8).

## Done when

- `docs/upstream-delta.md` records the 2026-10-06 review and both new features.
- Web apps and passes work end to end: `sharkctl apps create`, consent in the iPhone app, a page on
  the app origin receives and verifies a pass against the served JWKS.
- An agent with `board:write` can open, revise, cancel, and ack asks, maintain work items and
  notes, and read only its own rows; an agent token can never answer.
- The captain can answer, snooze, and dismiss from `/board` in Safari and inside the iPhone app,
  and from a lock-screen action on a linked push; every answer reaches the asking agent by callback
  or polling exactly once.
- shuvbro publishes its board through the adapter, answers round-trip into the keyed intake, and
  the old board is retired with the captain's approval.
- All gates pass; no secret, live token, generated build output, or unrelated change is committed.
