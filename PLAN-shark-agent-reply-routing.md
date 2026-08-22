# SHark Agent Reply Routing Plan

Status: ready to execute in phase order after repository review, four grilling rounds, final
repository-grounded revision, and a repository-grounded plan review (2026-08-20) whose corrections
are folded in below. Re-grounded against `main@669ed708` the same day: PR #30 (Live Activity
ending replay) and PR #31 (native macOS menu bar companion) landed after the review, shifting
citations and — decided with the user — adding the macOS companion as a second reply-capable
target surface. Phase 1 may begin immediately. Phase 2 remains gated on the shuvcode
admission spike described below; no broker schema or adapter implementation begins until that spike
is recorded in this plan.

## Goal

Make SHark the default path for agent questions that need a user response:

- Blocking questions should use SHark's existing free-text interaction and return the reply to the
  active agent turn.
- A completed turn with an actionable follow-up question should send one combined done-and-question
  notification with a reply field.
- A reply to a completed turn should start a new turn in the originating session without keeping the
  original agent process blocked.

The design should reuse the current interaction protocol and add the smallest practical amount of
local orchestration. In particular, v1 requires **no SHark server contract changes**, keeping the
fork's protocol surface aligned with upstream Hark
(see `AGENTS.md`, `docs/upstream-delta.md`).

## Current State

SHark already supports the blocking path:

- `sharkctl notify ask <prompt> --text --wait` creates a reply interaction and waits for an answer
  (`packages/sharkctl/src/cli.mjs:644-709`).
- `sharkctl interaction wait <id>` resumes waiting after a client-side timeout (`cli.mjs:633-640`).
- The returned interaction includes the user's text in `interaction.response`
  (`apps/website/src/server/routes/interactions.ts:140`).
- The iOS client queues replies durably in SecureStore with per-interaction dedupe
  (`apps/expo/src/lib/interactions.ts:20-157`), and the server atomically accepts only the first
  valid response via a conditional update on `status = 'pending'` (`interactions.ts:1132-1148`).
- The native macOS menu bar companion (PR #31, `apps/macos/`) is a second reply-capable surface.
  It registers through `POST /api/macos/devices` (`macos:register` scope) and answers approval,
  yes/no, and free-text prompts through `POST /api/macos/interactions/:id/respond`
  (`macos:respond` scope), which validates the action digest and applies the same atomic
  conditional update (`apps/website/src/server/routes/macos.ts:249-291`,
  `macosInteractionResponseSchema` at `packages/contracts/src/index.ts:803-814`). Interaction
  fanout pushes to active macOS companions with reply-capable notification categories
  (`interactions.ts:931-961`). Unlike the phone route, the macOS route does not set
  `respondingDeviceId`; the broker must consume only `status` and `response`, never the responding
  device identity.
- Interactions also fan out to web-push subscriptions, but web push remains notification-only in
  v1: the browser service worker displays the notification and opens the dashboard
  (`apps/website/public/sw.js:1-43`); the dashboard directs the user to respond from a
  registered iPhone (`apps/website/src/client/components/InboxPanel.tsx:383-390`), and the phone
  response route requires an active registered `deviceId` (`interactions.ts:1088-1101`). Browser
  reply UI and browser response credentials are out of scope.

### Contract facts that constrain this design

- **Token scoping.** `GET /interactions/:id` and `/wait` resolve interactions by
  `requesterTokenId`, not by user (`interactions.ts:176-183`). Whatever process polls for an answer
  must hold the same API token that created the interaction. This drives the ownership model below.
- **Wait endpoint mechanics.** `/interactions/:id/wait` holds a connection for at most 25 seconds
  and polls the database every 250 ms while waiting (`interactions.ts:1032-1057`). It is cheap for a
  blocking question and expensive if held hot for a day.
- **No list endpoint.** The agent API exposes only get, wait, and cancel by id
  (`interactions.ts:1027-1080`). Pending interactions cannot be enumerated from the server; a local
  registration store is the only index.
- **Limits.** Prompt max 2,000 chars, title max 80, expiry 30 s to 24 h with a **900 s default**
  (`packages/contracts/src/index.ts:719-732`); replies max 4,000 chars from both the phone
  (`index.ts:796`) and the macOS companion (`index.ts:810`).
- **Cancel exists.** `POST /interactions/:id/cancel` withdraws a pending prompt
  (`interactions.ts:1058-1080`).
- **Idempotency.** Interaction creation accepts an `Idempotency-Key` (`interactions.ts:635-667`).
- **Exit codes.** `sharkctl` exits 7 when no provider accepted the push (`cli.mjs:700`); a push
  nobody received will never produce a reply and must surface as a failure, not a silent success.
- **Reply-capable targets.** Unqualified interaction creation fans out to active iOS devices,
  active web-push subscriptions, and active macOS companion devices (`interactions.ts:55-125`).
  Web push cannot answer in v1; iOS devices and macOS companions can. Therefore `accepted > 0`
  proves a reply-capable target only when the request explicitly contains registered iPhone or
  macOS companion device ids.
- **Mixed device inventory.** `GET /api/agent/devices` now returns iOS, web-push, and macOS
  entries in one list sorted by `lastSeenAt`, each carrying a `platform` field
  (`interactions.ts:272-336`). Reply-capable selection must filter to active `ios` and `macos`
  entries explicitly.

### Existing callback mechanism (considered and rejected for this design)

SHark webhook-service notifications already support a `correlationId` and a server-pushed response
callback with bearer token and bounded retries
(`apps/website/src/server/lib/interaction-callbacks.ts:9-40`, documented in
`apps/website/src/shared/docs/content.ts:360-491`). This is the "push the answer to me" alternative
to local polling. It is rejected here because it requires a publicly reachable HTTPS endpoint on
the agent host, which is an explicit non-goal; local hosts sit behind NAT and should not expose a
callback surface for this feature. Note the asymmetry for the record: `correlationId` exists only
on the webhook path, not on the agent `interactionCreateSchema`. The broker does not need it —
interaction ids are returned at creation — but adding it to the agent path is the natural minimal
server change if durable server-side correlation is ever wanted. V1 deliberately makes no such
change.

What is missing is durable routing from an answered interaction to a session whose previous turn
has already ended. SHark knows the requesting token; it does not and should not know how or where
to resume a local agent harness.

## Recommended Shape

Keep the SHark server responsible for interaction delivery and response storage. Add a local reply
broker responsible for interaction creation, registration, and session routing.

```text
agent or completion hook
        |
        | turn-complete request (summary, question, session ref)
        v
 local reply broker ---- create interaction (broker's token) ----> SHark ----> iPhone / macOS companion
        |                                                            |
        | durable registration                                       | typed reply
        |                                                            v
        +------------------- bounded poll / wait <-------------------+
        |
        | harness adapter
        v
existing or resumed agent session
```

Do not store local paths, process identifiers, or harness credentials in the SHark database. Do not
make the production server call arbitrary local commands or private callback URLs.

### Token and ownership model

Because reads are scoped to the creating token, the broker package **creates deferred interactions
with its own dedicated token**. The package's `turn complete` command creates the interaction and
writes the registration to the shared store; the daemon later polls it using the same credentials.
This:

- guarantees the broker can always poll what it registered;
- keeps creation and registration in one CLI operation, with cleanup if either half fails;
- keeps agent-held tokens out of the deferred path entirely.

Blocking questions keep using the agent's own token through plain `sharkctl`, unchanged.

**Multiple hosts (settled).** Each host runs its own broker with its own API token. Because the
server scopes interaction reads to `requesterTokenId`, hosts cannot see or consume each other's
interactions even under one SHark account. Do not share broker tokens across hosts.

## Proposed Interfaces

### Blocking question

Continue using the existing command. The interaction expiry and the client wait are independent:
`--timeout` only controls how long the CLI waits, while the prompt expires server-side after
`--expires-in` (default 15 minutes). **Always pair them:**

```bash
sharkctl notify ask "Which deployment target should I use?" \
  --text --device "$REPLY_DEVICE_ID" \
  --wait --expires-in 30m --timeout 30m
```

For a blocking ask, resolve the intended reply-capable devices with `sharkctl devices list` — the
response mixes iOS, web, and macOS entries with a `platform` field — select active `ios` or
`macos` entries, and pass their ids with `--device` (repeatable). Do not rely on an unqualified
`accepted > 0` when web push is enabled: a browser subscription may accept the notification but
cannot submit a reply in v1.

Also change `sharkctl`: when `notify ask --wait --timeout X` omits both the `--expires-in` flag and
`stdin.expiresIn`, derive the interaction expiry from the timeout. Clamp the derived value to the
server range of 30 seconds through 24 hours; when the ask is effectively a Live Activity, clamp it
to 30 seconds through the existing 8-hour Live Activity maximum. "Effectively a Live Activity"
means the same combined boolean the CLI already computes — the `--live-activity` flag **or**
`stdin.presentation === "live_activity"` (`packages/sharkctl/src/cli.mjs:666`) — not the flag
alone; otherwise a stdin-presentation ask with a long `--timeout` would derive an expiry above
8 hours and hit the existing hard `UsageError` (`cli.mjs:673-675`) instead of clamping. Explicit
flag or stdin expiry always wins. This rule does
not apply to `--poll`. Emit a stderr warning whenever the wait timeout exceeds the effective expiry,
because waiting beyond expiry is pointless. `--wait` without `--timeout` remains unchanged: its wait
duration defaults to the effective interaction expiry. Record this accepted CLI behavior delta in
`docs/upstream-delta.md` and update `packages/sharkctl/README.md` as well as the skill.

Update `skills/shark/SKILL.md` so genuinely blocking free-text questions prefer this path over
yes/no prompts or an unanswered question in chat. The agent reads `interaction.response` and
continues the same turn, branching on exit status (`0` replied, `4` timeout/expired/canceled,
`7` no selected reply-capable provider accepted the push). Exit `5` (denied/no) cannot occur for a
`--text` ask, but the skill's existing exit-code documentation for approval and yes/no prompts
(`skills/shark/SKILL.md:173`) covers it and must not regress in this update.

### Completed turn with a question

Add a completion operation to the broker's `sharkd` binary, not to `sharkctl`:

```bash
sharkd turn complete \
  --summary "Implementation and tests are complete." \
  --question "Should I open the pull request?" \
  --title "Agent task" \
  --session-ref-file "$HARNESS_SESSION_REF" \
  --idempotency-key "$TURN_ID"
```

Behavior:

- Without `--question`: send a plain completion notification (equivalent to `sharkctl notify`) and
  exit. `--session-ref-file` is not required. No registration or reply path is created. The
  idempotency key remains required so completion-hook retries do not duplicate the notification.
  The trimmed summary is truncated to the 2,000-character notification body limit
  (`packages/contracts/src/index.ts:916`). This path uses unqualified fanout: web push and macOS
  companions may receive
  the notification because no reply is needed. `accepted === 0` exits 7; notifications have no
  cancel endpoint and no pending server state, so nothing is canceled and no durable local row is
  written beyond the idempotency record. Note that server idempotency namespaces are per endpoint
  (`agent_notification` versus `interaction` tables), so the same key retried first without and
  then with `--question` would not conflict server-side; the broker's local key-uniqueness check is
  the only cross-shape protection and must treat that sequence as a hard local conflict.
- With `--question`: ask the broker to create a text interaction whose visible prompt combines the
  summary and question, target reply-capable devices (registered iPhones and macOS companions)
  explicitly, register it durably, and
  return immediately. `--session-ref-file` is required. The broker lists devices with its dedicated
  token, filters the mixed-platform response to active `ios` and `macos` entries, and puts at most
  the 50 most recently seen reply-capable ids in `deviceIds`, matching the server
  contract maximum; web-push subscriptions are notification-only in v1. The create payload is
  persisted byte-stable so replay produces an identical request; the server itself dedupes and
  sorts `deviceIds` before hashing and orders fanout by its own `lastSeenAt`
  (`packages/contracts/src/index.ts:730`, `interactions.ts:111`), so id order carries no server-side
  meaning and is preserved only for local replay stability.
- Deferred questions expire after 8 hours by default; `--expires-in` may raise this to the server's
  24-hour maximum. An expired question is archived silently with no reminder or automatic re-ask.
- Trim leading and trailing whitespace from summary, question, and title before validation and before
  persisting the create payload; reject an empty question. The exact prompt template is
  `${summary}\n\n${question}` when at least one normalized summary character plus the two-newline
  separator fits. Truncate only the summary to make that template fit. If no summary character and
  separator fit, omit both and send the normalized question alone; therefore a question of exactly
  2,000 characters remains valid. Reject a question above 2,000 characters rather than truncate it.
  `--title` is optional, defaults to `SHark`, and is rejected above 80 characters rather than
  silently truncated. These normalized values are the values covered by idempotency hashing.
- `--idempotency-key` is trimmed before validation, local uniqueness checks, persistence, and remote
  submission; the normalized value is required and must contain 1 to 200 characters. Harness hooks
  derive it from stable session and turn identifiers before invoking `sharkd`; the broker does not
  invent a key from incomplete metadata. Reusing a normalized key with any different create payload
  is a hard conflict.
- If device discovery finds no active reply-capable device (iPhone or macOS companion), no
  interaction is created and the command
  exits 7. If creation returns the server's definitive `Invalid device selection` validation error,
  the idempotency key was rejected before interaction insertion (`interactions.ts:685` precedes the
  insert at `interactions.ts:801`). Mark that local `creating` row `rejected` and exit 1; a later
  invocation may replace that rejected payload after fresh discovery while retaining the same key.
  This is the only allowed payload-replacement exception. Any successful or ambiguous create
  attempt must replay the exact persisted payload. Classification of this outcome is deliberately
  strict: it requires HTTP status 400 **and** an error body whose `error` field is exactly
  `Invalid device selection`; anything else falls into the general outcome matrix. Because this is
  a human-readable message rather than a machine code, a broker fixture test pins the server
  literal, and `docs/upstream-delta.md` records the string alongside the fork's other pinned
  compatibility names so upstream Hark merges that reword it are flagged instead of silently
  degrading the replacement path into terminal `rejected`.
- If a non-idempotent initial response reports `accepted === 0`, the command exits 7. Because SHark
  has already created the interaction, the broker first persists the returned interaction id and
  enters a `canceling` state, then cancels it server-side. Successful cancellation archives the local
  row as `undeliverable`; failed cancellation retains the row for cleanup retry. An idempotent zero
  follows the separate `reconciling_zero` rule below and exits 6 while unresolved. A prompt nobody
  received must not remain as an untracked pending server interaction.
- If the initial adapter probe is `unknown`, no interaction is created and the command exits 6 as a
  transient local/harness failure. The completion hook may retry with the same idempotency key.

`sharkd` uses stable process exit codes: `0` accepted/successful, `1` permanent runtime failure, `2`
usage or validation error, `3` broker credential/configuration failure, `4` definitive missing or
terminal target, `6` transient network/harness failure, and `7` no active reply-capable device or no
selected provider accepted the notification. Machine-readable stdout contains no token or reply
text unless the operator explicitly runs `queue show`.

The session reference is produced by trusted harness integration code, never assembled from the
user's reply. It is a versioned common envelope plus an adapter-validated bounded JSON object:

```json
{
  "version": 1,
  "harness": "shuvcode",
  "sessionId": "opaque-session-id",
  "cwd": "/trusted/project/path",
  "adapterData": {}
}
```

The broker rejects session-reference files above 64 KiB, JSON nesting deeper than 8 levels,
`sessionId` above 512 characters, `cwd` above 4,096 characters, and `adapterData` whose serialized
form exceeds 16 KiB. It validates `version`, `harness`, `sessionId`, and optional `cwd`; the selected
adapter validates the bounded `adapterData`. This avoids central schema churn without accepting
unbounded arbitrary configuration. None of these local fields is sent to SHark.

### Reply broker

One registration operation hides polling, persistence, retry, and harness differences:

```ts
register({ summary, question, session, expiresAt, idempotencyKey })
// broker creates the interaction and returns { interactionId }
```

Harness-specific behavior sits behind one adapter seam:

```ts
interface SessionAdapter {
  probe(session: SessionRef): Promise<"available" | "missing" | "unknown">;
  deliver(session: SessionRef, message: DeferredReply): Promise<DeliveryResult>;
}

type DeliveryResult =
  | { status: "delivered" }
  | { status: "busy" }
  | { status: "failed"; retryable: boolean; diagnostic: string };
```

The common result vocabulary is provisional until the shuvcode spike. The spike must prove how
shuvcode distinguishes admission, busy/queued delivery, definitive missing sessions, ambiguous
network failures, wake behavior, and durable `deliveryId` deduplication. Record the observed API and
revise this seam before creating the broker schema. Adapter diagnostics must not contain reply text,
tokens, or local credentials.

The broker:

- persists pending registrations in a local SQLite database using Node >=22.13.0's built-in
  `node:sqlite`
  `DatabaseSync` API in WAL mode; the CLI and daemon share this database directly, with a bounded
  busy timeout and no local RPC or HTTP surface. This avoids adding a native package dependency to
  the otherwise dependency-light broker;
- treats the local store as the **sole index** of pending deferred interactions — the server cannot
  enumerate them, and store loss is unrecoverable by design in v1 (documented and backed up with
  the host's normal backup policy);
- creates registrations through a crash-safe state machine: after a successful initial adapter
  probe, transactionally insert a `creating` row containing the exact complete SHark request JSON
  and normalized idempotency key plus the preflight `token.id`, call SHark, then attach the returned
  interaction id and server `expiresAt` and mark it `pending`. Replay uses the byte-equivalent
  persisted create payload, including the original `expiresInSeconds`, so the server request hash
  cannot change. On startup, replay any `creating` row with the same key so SHark returns the same
  interaction instead of creating an orphan. Poll, replay, and cancel are blocked when the currently
  loaded token id differs from the row's persisted token id;
- handles a non-idempotent initial create response with `accepted === 0` by persisting the returned
  interaction id, transitioning to `canceling`, and invoking the server cancel endpoint. A successful
  cancel archives the row as `undeliverable`; a failed or ambiguous cancel remains durable and is
  retried. The command exits 7 on this synchronous initial path;
- does not treat an idempotent replay response with `accepted === 0` as definitive, because a
  concurrent original request may have inserted the row but not yet persisted push results. It enters
  `reconciling_zero`, cold-polls get/status, promotes to `pending` if `accepted > 0`, processes any
  terminal response normally, and otherwise retains the tracked row until expiry or explicit operator
  cancellation. V1 makes no unsafe timing assumption and adds no server processing-state contract;
- classifies create outcomes deterministically: `401`/`403` becomes durable `auth_blocked` and exits
  3; `409` idempotency mismatch becomes terminal `conflict` and exits 1; `429`, network errors,
  malformed/aborted responses, and `5xx` remain replayable `creating` and exit 6; definitive
  `Invalid device selection` (status 400 plus the exact pinned error string, per the strict
  classification above) becomes `rejected` with the sole payload-replacement allowance described
  above and exits 1; every other `4xx` becomes terminal `rejected` with no payload replacement and
  exits 1; a valid response with `accepted > 0` becomes `pending` and exits 0;
- polls **cold** for deferred questions immediately at daemon startup, then every 45 seconds with
  ±10% jitter, not through a continuously re-issued hot `/wait`. Network errors use exponential
  backoff capped at 15 minutes. A hot wait costs ~4 DB reads/sec per registration on the server for
  up to 24 h and buys nothing for a question that is not blocking anyone;
- assigns every reply a stable `deliveryId` exactly once when the broker first observes the
  interaction in `replied` state, persists it in the same transaction as the reply state, and
  requires adapters to deduplicate it before admitting a turn. An ambiguous crash is retried with
  the same id, producing end-to-end effectively-once delivery rather than choosing between
  duplicates and intentional reply loss;
- queues or retries when the target session is busy;
- retries harness delivery after 5 seconds, 30 seconds, 2 minutes, 10 minutes, and 1 hour; then
  retains the reply as failed for inspection and manual recovery and sends one plain SHark failure
  notification;
- probes the target session before creating an interaction, every 15 minutes while pending, and
  immediately before delivery. A definitive initial `missing` result creates no interaction. A
  definitive later `missing` result transitions to `canceling`, cancels the delivered prompt on the
  user's devices, and
  archives locally; `unknown` (including network failure) backs off and never creates or cancels;
- removes or archives expired registrations; and
- passes reply text as structured data, never shell source.

Cancellation reconciles races from the terminal interaction returned by the server. A successful
cancel archives `canceled`. A `409` containing `expired` or `canceled` archives that state. A `409`
containing `replied` mints/persists the stable `deliveryId` and enters normal delivery; if the session
is definitively missing, retain it as failed for manual recovery and send the one failure notification
rather than discard the user's reply. Any other terminal response is archived with its exact state;
transport ambiguity leaves the row `canceling` for retry with the same token identity.

The resumed user turn includes the stable `deliveryId`, original question, and user's reply so the
adapter can deduplicate admission and the model can interpret the answer in the correct context.

Delivered, expired, canceled, and undeliverable rows are retained for 7 days, then purged. Failed
replies and ambiguous cancel operations remain until an operator explicitly retries or discards
them. `sharkd status` summarizes service state, database access, queue counts, and last successful
poll without reply text; `sharkd queue list|show|retry|discard` provides recovery controls, and only
`show` may print reply text. `discard` on a still-pending or canceling registration must first reach
a terminal server state; if cancellation is ambiguous, discard fails and retains the row.

The no-RPC health contract is a singleton SQLite `daemon_state` row containing random `instanceId`,
PID, absolute executable path, `startedAt`, `heartbeatAt`, `lastPollAt`, and a redacted
`lastErrorClass`. After config validation and database migration, the daemon writes its startup row
and refreshes `heartbeatAt` every 30 seconds even when the queue is empty or SHark is unreachable.
`sharkd status` reports healthy only when the service manager says the recorded PID is running with
the expected executable and the heartbeat is at most 90 seconds old. Service install/restart waits up
to 20 seconds for a new `instanceId` heartbeat, then fails health verification without deleting state
or credentials. Credential preflight occurs in the service command before launch; ordinary later
network/auth failures are represented in `lastErrorClass` and backoff rather than suppressing the
local heartbeat.

### Packaging

The broker, its store, its adapters, and the `turn complete` command live in the new private sibling
package `packages/shark-broker/` named `@hark/shark-broker`, whose executable is `sharkd` and whose
package engine is Node `>=22.13.0`, not inside `packages/sharkctl/`.
Rationale: `AGENTS.md` declares this repo a minimally rebranded Hark fork whose protocol clients
should track upstream; `sharkctl` is the package most likely to need upstream syncing, and a
daemon plus durable store there maximizes merge pain.

Extract sharkctl's current HTTP request primitives from `src/cli.mjs` into
`packages/sharkctl/src/client.mjs`. Add the supported public subpath export
`"./client": "./src/client.mjs"` to `packages/sharkctl/package.json`; keep the existing CLI entry
unchanged. Note that `packages/sharkctl/package.json` currently declares **no** `exports` or `main`
field, so introducing an `exports` map is a published-package behavior change: previously possible
deep imports such as `sharkctl/src/cli.mjs` become external resolution errors. Nothing in this
repository does that (`bin/sharkctl.mjs` uses a relative path and is unaffected), and deep source
imports were never a supported surface. Export `"./client"` and `"./package.json"`, state in
`packages/sharkctl/README.md` that `./client` is the only supported import, and record the accepted
packaging delta in `docs/upstream-delta.md`. The exported surface is deliberately small:
`RequestError`, a generic authenticated
request helper, file config validation, and typed-by-convention helpers for notification creation and
interaction create/get/cancel. `packages/shark-broker/package.json` depends on `sharkctl` via
`workspace:*` and imports `sharkctl/client`; it never imports `src/` by relative path. Re-export the
existing symbols needed by `cli.mjs` so current CLI tests remain valid. This behavior-preserving
refactor avoids hot-path subprocesses, avoids coupling the daemon to CLI argument parsing, and keeps
one implementation of authentication and API error handling.

The broker does **not** call sharkctl's general `loadConfig(env)` unchanged. That function currently
prefers ambient `HARK_TOKEN` over `HARK_CONFIG` (`packages/sharkctl/src/cli.mjs:146-153`), which would
violate dedicated-token ownership. The extracted client provides a file-only loader that accepts an
explicit config path, validates mode `0600`, reads `token` and `apiUrl` from that file, and ignores
ambient `HARK_TOKEN` and `HARK_API_URL`. The broker fails closed if the file is missing, insecure, or
invalid.

Before registration, the command calls agent auth status through the extracted client and requires
`notifications:send`, `interactions:create`, `interactions:read`, and `devices:read`. Revoked,
expired, or insufficiently scoped credentials exit 3 before creating a local row. If credentials are
revoked in the race after that preflight, the already-durable `creating` row remains blocked for
operator remediation and is never discarded or replayed under a different token.

V1 supports both Linux and macOS service lifecycle. Linux `shuvdev` is the primary deployment and
uses a per-user systemd service; macOS `shuvbot` is the secondary deployment and uses a LaunchAgent
with keep-alive. The daemon reads a dedicated token from a broker-owned config file (mode `0600`)
provisioned through sharkctl's existing alternate config support:

```bash
BROKER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/shark-broker"
install -d -m 700 "$BROKER_DIR"
env -u HARK_TOKEN -u HARK_API_URL \
  HARK_CONFIG="$BROKER_DIR/hark-config.json" \
  sharkctl auth login \
  --client-name "SHark broker $HOSTNAME" \
  --scope notifications:send \
  --scope interactions:create \
  --scope interactions:read \
  --scope devices:read
```

The token must not appear in the systemd unit, LaunchAgent plist, environment, or shell history.
Only the config path appears in service definitions.

`sharkd service install|status|restart|uninstall` auto-detects the supported host platform and owns
the corresponding service lifecycle:

- **Linux (primary):** resolve the current Node executable and installed `sharkd` entry point to
  absolute paths, install `~/.config/systemd/user/sharkd.service`, run
  `systemctl --user daemon-reload` and `systemctl --user enable --now sharkd`, then verify daemon
  health. The unit uses `Restart=on-failure` and contains paths but no token; the broker's own
  bounded backoff handles network unavailability. Persistent operation after logout/reboot requires
  lingering. `service install` fails closed before enabling the unit when lingering is disabled and
  prints the exact one-time administrator command (`loginctl enable-linger <user>`); it never invokes
  `sudo` itself.
- **macOS (secondary):** resolve absolute Node and `sharkd` paths, write a reviewed LaunchAgent plist
  containing those paths and the broker config path but no token, bootstrap it with `launchctl`,
  enable keep-alive, and verify daemon health.

Both service definitions explicitly remove `HARK_TOKEN` and `HARK_API_URL` from the daemon
environment. The broker obtains the production origin only from its protected config file. Service
installation refuses relative executable paths so later shell or package-manager changes cannot
silently redirect the daemon. Installation also executes an import smoke test for `node:sqlite` and
requires Node >=22.13.0 without an experimental runtime flag before writing either service. Even
unflagged, importing `node:sqlite` still emits an `ExperimentalWarning` on stderr in current Node
releases; the smoke test, `sharkd` logging expectations, and service-log health checks must
tolerate exactly that warning and nothing else.

V1 does not support a root-managed systemd unit. Keeping the service per-user keeps the daemon,
credentials, and SQLite state under one `shuvdev` ownership boundary.

Credentials live at `$XDG_CONFIG_HOME/shark-broker/hark-config.json` (fallback
`~/.config/shark-broker/hark-config.json`). SQLite lives at
`$XDG_STATE_HOME/shark-broker/broker.sqlite` (fallback
`~/.local/state/shark-broker/broker.sqlite`). Directories are mode `0700`, files mode `0600`, and
the state directory is included in the host's normal backup boundary.

When the package is added, update `AGENTS.md` architecture and validation commands to include
`packages/shark-broker/`. The package remains private in v1; `sharkd` is installed from the reviewed
workspace/package artifact on each host rather than published as a public npm package.

## Harness Order

The harness-side interfaces below are **assumptions from outside this repository** and are not
verifiable here. Phase 2 begins with a spike that proves the first adapter's real admission
semantics before the broker contract hardens around them.

1. **shuvcode** (assumed: `POST /api/session/:sessionID/prompt` with queued delivery and wake
   behavior) — first target.
2. **shuvpi** (assumed: `sendUserMessage(..., { deliverAs: "followUp" })` for a live session or
   persistent RPC prompt delivery).
3. **Codex** (assumed: app-server `thread/resume`, then `turn/start`).
4. **Claude Code** (assumed: live `asyncRewake`; `claude --resume` only when process ownership and
   concurrency are understood).
5. **Grok**: deferred until a reliable programmatic prompt-injection interface is verified.

The first implementation proves exactly one adapter before generalizing the broker or touching
additional harnesses.

## Phases

### Phase 1: Blocking Questions

- Strengthen `skills/shark/SKILL.md` guidance for free-text blocking questions, including the
  mandatory `--expires-in`/`--timeout` pairing, explicit reply-capable device targeting (active
  `ios` and `macos` entries) when web push is enabled, and exit-code branching, without regressing
  the existing exit-5 (denied/no)
  documentation for approval and yes/no prompts.
- Modify `packages/sharkctl/src/cli.mjs` so omitted expiry for `--wait --timeout` follows the exact
  clamped derivation above — keyed on the effective Live Activity boolean (flag or
  `stdin.presentation`), not the flag alone — and emits the ineffective-wait warning.
- Update `packages/sharkctl/README.md` and `docs/upstream-delta.md` for the accepted behavioral delta.
- Add focused coverage in `packages/sharkctl/test/cli.test.mjs` for flag and stdin precedence,
  30-second and 24-hour clamps, the 8-hour Live Activity clamp via both the `--live-activity` flag
  and `stdin.presentation === "live_activity"`, warning behavior, and unchanged `--poll` behavior.
- Document how agents safely extract and process `interaction.response` (untrusted data, max
  4,000 chars, never shell source).
- Add examples that distinguish approval, yes/no, and detailed reply use cases.
- Verify behavior with existing CLI and server tests. This phase changes CLI behavior and guidance,
  not the SHark server protocol.

### Phase 2: Deferred Reply Proof

- **Spike first:** verify the shuvcode prompt-admission endpoint's actual queued/wake semantics,
  missing-session signal, ambiguous failure behavior, and durable delivery-id deduplication against
  a real session. Record the endpoint, request shape, response outcomes, concurrency behavior, and
  evidence in this plan before creating `packages/shark-broker/`, its schema, or its adapter seam.
- Extract and export `packages/sharkctl/src/client.mjs`, add the `sharkctl/client` and
  `./package.json` package exports, record the packaging delta in `docs/upstream-delta.md`, and
  keep broker credentials file-only as specified above.
- Create the sibling broker package with the durable registration store, including the fixture test
  that pins the `Invalid device selection` server literal, and add that string to
  `docs/upstream-delta.md`'s pinned compatibility names.
- Add the minimal broker process and systemd user-service lifecycle on primary Linux host
  `shuvdev`, including the lingering preflight.
- Add the LaunchAgent lifecycle for secondary macOS host `shuvbot` in the same v1 phase.
- Add the `turn complete` command (create-and-register, no waiting, idempotent, exit-7 aware).
- Implement the shuvcode session adapter.
- Update `AGENTS.md` with the new package and narrow validation commands.
- Verify end to end: creation, process exit, delayed phone reply, session wake, new turn, duplicate
  suppression, expiry, cancel-on-dead-session, and unavailable-session recovery.

### Phase 3: Harness Integration

- Add shuvpi support after the broker contract is stable.
- Add Codex and Claude support with explicit live-session versus process-resume behavior. Each
  adapter begins with a spike that proves its harness-specific liveness check before any resume
  process can be spawned; do not impose an unverified cross-harness convention now.
- Add harness hooks that provide trusted session references and completion metadata.
- Keep adapter-specific configuration out of SHark's server contracts.

### Phase 4: Completion Detection

- v1 requires an **explicit** structured question supplied by the agent or harness integration.
- Retain a later evaluation of one strict deterministic safety net: only a final paragraph that
  begins exactly `Question for user:` and contains one non-empty question ending in `?` is a
  candidate when the structured field is absent. Evaluate it offline on reviewed fixtures and
  require zero false positives before enabling it. Do not shadow-log production transcript text or
  add a per-turn LLM classifier.
- Summaries are composed by the originating harness; a shared helper only validates and truncates
  the summary to the concrete prompt limit. Questions and titles are validated and rejected rather
  than truncated.

## Validation

Minimum automated coverage:

- existing blocking text replies still return the correct response and exit status;
- a blocking ask with `--timeout` and no explicit `--expires-in` gets an expiry of
  `clamp(timeout, 30s, 24h)`, or `clamp(timeout, 30s, 8h)` for an effective Live Activity selected
  by either the `--live-activity` flag or `stdin.presentation === "live_activity"`;
- `stdin.expiresIn` counts as explicit, `--expires-in` overrides stdin, and `--poll` retains its
  existing expiry behavior;
- a blocking ask whose wait timeout exceeds its effective expiry emits a stderr warning;
- blocking guidance targets reply-capable devices (active `ios` and `macos` entries) explicitly
  when web push is enabled;
- `turn complete` returns before the interaction is answered;
- `turn complete` rejects a question that cannot fit within the 2,000-character prompt budget and
  rejects titles above 80 characters; whitespace normalization and summary omission produce the
  exact persisted prompt template at every boundary;
- `turn complete` without `--question` truncates the summary to the 2,000-character notification
  body limit, exits 7 on `accepted === 0`, and persists no durable local row beyond the idempotency
  record;
- retrying the same idempotency key first without and then with `--question` is a hard local
  conflict even though server idempotency namespaces are per endpoint;
- `turn complete` with no active reply-capable device creates no interaction and exits 7;
- device discovery deterministically selects at most the 50 most recently seen active reply-capable
  devices, filtering the mixed-platform `/api/agent/devices` response to active `ios` and `macos`
  entries and never selecting `web` entries (asserted against the broker's local selection; the
  server dedupes, sorts, and re-orders ids, so payload order is verified only for byte-stable
  replay);
- a device that exists but went inactive between discovery and create yields a valid selection with
  a possible `accepted === 0` — handled by the cancel-on-zero path — rather than
  `Invalid device selection`;
- `turn complete` with an initial adapter probe of `unknown` creates no interaction and exits 6;
- `turn complete` with a non-idempotent initial `accepted === 0` exits 7, durably cancels the created
  interaction, and leaves no untracked pending interaction; ambiguous cancellation remains visible
  in recovery state;
- retried `turn complete` with the same idempotency key creates one prompt;
- the same idempotency key with a different persisted create payload fails as a conflict;
- a crash in every transition around remote creation is recovered from the prepared `creating` row
  by replaying the same idempotency key, with no orphan interaction;
- replay uses the exact original create payload and handles an idempotent `accepted === 0` response
  through `reconciling_zero` without canceling a potentially in-flight successful delivery;
- the create outcome matrix maps auth, conflict, rate-limit, network, `5xx`, definitive validation,
  accepted-zero, and accepted-positive responses to the specified durable state and exit code;
- a definitive pre-insertion `Invalid device selection` response marks the local row rejected and
  permits fresh-device payload replacement on a later invocation; no other response permits payload
  replacement; classification requires HTTP 400 plus the exact error literal, a fixture test pins
  that literal against the server route, and any other 400 body falls into terminal `rejected`
  without replacement;
- broker state survives restart;
- every row persists the creating `token.id`; changing the broker config token blocks replay, polling,
  and cancellation rather than silently changing the server ownership namespace;
- ambient `HARK_TOKEN` and `HARK_API_URL` cannot override the broker's protected config file;
- broker config loading fails closed for a missing file, a non-`0600` file, malformed JSON, a missing
  or invalid token/API origin, and any ambient `HARK_CONFIG` that differs from the explicit broker
  path;
- revoked or expired broker credentials and credentials missing any required scope map to exit 3,
  create no new local registration, and produce a redacted actionable diagnostic;
- the `sharkctl/client` export works from the broker package without importing sharkctl source paths;
- SQLite opens in WAL mode, honors its busy timeout under concurrent CLI/daemon access, and recovers
  every migration/state transition after restart;
- an idle daemon refreshes its heartbeat, stale or mismatched PID/executable state is unhealthy, and
  install/restart requires a new instance heartbeat within 20 seconds;
- systemd user-service install/status/restart/uninstall works on Linux, fails clearly when lingering
  is disabled before enabling the unit, uses absolute executable paths, contains no token, and
  survives logout/reboot after lingering is enabled;
- LaunchAgent install/status/restart/uninstall works on macOS with absolute Node and `sharkd` paths,
  the explicit broker config path, ambient token/API isolation, no token in the plist, and a clear
  failure when post-bootstrap daemon health cannot be verified;
- ambiguous delivery retries reuse one `deliveryId`, and the adapter admits one new agent turn;
- replies are delivered to the correct harness and session;
- a reply is consumed identically whether it was submitted from an iPhone or the macOS companion:
  the broker reads only terminal `status` and `response` and never depends on `respondingDeviceId`,
  which the macOS route does not set;
- an active session receives queued or follow-up input instead of a competing turn;
- expired, canceled, denied, missing, and deleted-session cases settle predictably, including the
  broker canceling the prompt for a deleted session;
- cancellation races process returned `replied` content through delivery/manual recovery and archive
  returned `expired`/`canceled` states without losing a reply;
- an adapter `unknown` probe result never cancels a prompt, while a definitive `missing` result does;
- existing server coverage proves unqualified interactions may fan out to web push, while broker
  coverage proves deferred interactions contain only reply-capable device ids (`ios` and `macos`)
  and never target or
  deliver to web-push subscriptions;
- reply text containing shell syntax remains inert structured input; and
- no token, callback credential, local path, or reply content leaks into logs unexpectedly.

Repository checks begin with the narrow package tests and builds, then broaden:

```bash
pnpm --filter sharkctl test
pnpm --filter sharkctl build
pnpm --filter @hark/shark-broker test
pnpm --filter @hark/shark-broker build
pnpm typecheck
pnpm test
pnpm lint
pnpm brand:check
```

Before `packages/shark-broker/` exists, omit its two filter commands. Automated tests use synthetic
tokens, device ids, session references, replies, and HTTP fixtures. A physical-phone or real-session
acceptance test may send an actual interaction only with the user's explicit authorization, per
`AGENTS.md`.

Each harness adapter also gets an integration fixture proving a reply reaches a real or faithful
local session interface. Linux lingering/logout/reboot checks and macOS LaunchAgent lifecycle checks
are host acceptance tests, not portable CI requirements; CI must still test generated service files
and command behavior with synthetic fixtures.

## Rollback

- Phase 1 is independently reversible: restore the prior sharkctl expiry default and skill guidance;
  no server or persisted-data migration is involved.
- Before disabling a deployed broker, stop new completion hooks, inspect `sharkd status`, and use the
  queue controls to cancel every pending SHark interaction. Do not strand answerable prompts whose
  local route has been removed.
- `sharkd service uninstall` stops and removes only the user service definition. It preserves the
  protected broker config and SQLite database by default so rollback or forensic recovery remains
  possible. Credential or state deletion requires a separate explicit operator action.
- Re-enabling the last reviewed broker artifact against the preserved database resumes polling and
  state recovery. If the database is intentionally discarded, first cancel pending interactions;
  server enumeration cannot recover them.
- Broker token revocation is separate from service uninstall. Revoke it only after pending prompts
  are canceled or deliberately abandoned.

## Risks and Constraints

- A provider accepting a push does not prove the notification was displayed or answered.
- An unqualified interaction can be accepted only by web push even though browsers cannot answer in
  v1. Blocking guidance and the broker therefore explicitly target reply-capable devices
  (registered iPhones and macOS companions).
- A completion reply may arrive while the target session is active, idle, closed, moved, or
  deleted.
- Starting a second Claude or Codex process against an active session may corrupt or race session
  state.
- Harness session identifiers and resume semantics are not uniform, are unverified from this
  repository, and may change independently.
- Free-text replies are user input and must never be interpolated into shell commands, paths, or
  executable configuration (consistent with `skills/shark/SKILL.md` Security Boundaries).
- The local broker introduces process supervision and durable state that must remain observable
  and recoverable without becoming a general workflow engine.
- `node:sqlite` raises the broker package's runtime floor to Node >=22.13.0 even though the wider
  repository permits older Node 22 releases. Host acceptance must use the exact executable that the
  generated service invokes and prove `node:sqlite` imports without an experimental flag (an
  `ExperimentalWarning` on stderr is expected and tolerated; any other warning is not).
- The `Invalid device selection` replacement path pins a human-readable server error string rather
  than a machine code. An upstream Hark reword would be caught by the broker fixture and the
  `docs/upstream-delta.md` entry; until re-pinned, the failure mode is safe but degraded (terminal
  `rejected` with no payload replacement).
- Effectively-once delivery depends on each adapter proving durable `deliveryId` deduplication. An
  adapter that cannot prove it does not ship.
- Loss of the broker's local store strands pending interactions until they expire (≤ 24 h); they
  remain answerable on the user's devices but the answers become undeliverable. This is accepted in
  v1.
- Deferred questions default to 8 hours and can opt into at most 24 hours. The server rejects replies
  after expiry, so there is no separate late-response delivery path.

## Explicit Non-Goals

- Any SHark server or contract change in v1 (including a pending-interactions list endpoint and
  `correlationId` on the agent path).
- A public callback server for local agent sessions (the existing webhook callback mechanism stays
  webhook-only).
- Arbitrary command callbacks configured through SHark.
- Server-side knowledge of any harness.
- A new interaction type per harness.
- Automatic execution of instructions contained in reply text.
- Guaranteed support for every agent harness in the first release.
- An LLM classifier on completion events in the first release.
- Browser and Apple Watch free-text replies in v1.
- Publishing `packages/shark-broker/` as a public npm package in v1.

## Decisions

### Settled by repository evidence

- **Broker must poll with the creating token** — server scopes reads by `requesterTokenId`.
- **Multi-host isolation** — one token per host; server-side scoping prevents cross-consumption.
- **Blocking-ask expiry** — `--expires-in` must accompany long `--timeout`; default expiry is 15 m.
- **Prompt/reply size budget** — 2,000 / 80 / 4,000 chars; truncation strategy defined above.
- **No server enumeration of pending interactions** — local store is the sole index.
- **Callbacks rejected** for this feature; mechanism acknowledged and left webhook-only.
- **Reply surfaces** — v1 free-text responses come from a registered iPhone or the macOS menu bar
  companion (added by PR #31 and adopted into this plan 2026-08-20); browser web push
  is notification-only and Apple Watch rejects text replies.

### Settled through grilling

- **Ownership and isolation** — the sibling broker package creates deferred interactions with a
  dedicated per-host token; CLI and daemon share the token through a mode-`0600` config file. Broker
  loading ignores ambient `HARK_TOKEN` and `HARK_API_URL`.
- **Packaging and lifecycle** — `packages/shark-broker/`, executable `sharkd`; primary Linux
  `shuvdev` uses a lingering-enabled systemd user service, while secondary macOS `shuvbot` uses a
  keep-alive LaunchAgent. Root-managed systemd mode is out of scope for v1.
- **Process split and store** — the CLI creates and registers; the daemon polls and delivers; both
  share built-in `node:sqlite` on Node >=22.13.0 in WAL mode with a busy timeout and no IPC surface.
- **Reply semantics** — always a new turn in v1, queued as follow-up when the target is busy.
- **Expiry** — 8-hour deferred default, 24-hour opt-in max, silent archive on expiry, no reminder.
- **Failure** — retain in a recovery queue and send one plain SHark failure notification.
- **Server scope** — no v1 server contract changes; local store loss is an accepted bounded risk.
- **Content ownership** — the harness supplies summary and question; shared code only validates and
  truncates.
- **Harness order** — shuvcode first; later harness liveness mechanisms are proven by adapter spikes.
- **Blocking timeout** — when flag and stdin expiry are absent, sharkctl derives expiry from timeout,
  clamps it to 30 seconds through 24 hours (8 hours for an effective Live Activity, keyed on the
  flag-or-stdin-presentation boolean), and warns when the wait exceeds effective expiry. Polling is
  unchanged.
- **Completion detection** — explicit structured questions in v1; retain, but do not enable, a
  future deterministic heuristic evaluation.
- **Client reuse** — expose the supported `sharkctl/client` package subpath (plus `./package.json`);
  do not spawn the CLI per poll, import package source paths, or duplicate HTTP/error logic. Adding
  the `exports` map is an accepted published-package delta recorded in `docs/upstream-delta.md`;
  deep source imports were never supported.
- **Strict error classification** — the payload-replacement path requires HTTP 400 plus the exact
  `Invalid device selection` literal, pinned by a broker fixture and listed among the fork's
  compatibility names in `docs/upstream-delta.md`.
- **Plain completion path** — without `--question`, the summary truncates to the 2,000-character
  notification body limit, fanout may include web push, `accepted === 0` exits 7 with nothing to
  cancel, and cross-shape idempotency reuse is a hard local conflict.
- **Crash-safe creation** — persist `creating` before the network call and reconcile by idempotent
  replay of the exact persisted create payload. A definitive non-idempotent `accepted === 0` enters
  durable server cancellation; an idempotent zero reconciles without unsafe cancellation.
- **Session probing** — registration, 15-minute pending cadence, and pre-delivery; only definitive
  `missing` cancels. Probe before creation; initial `missing` creates no interaction.
- **Idempotency** — `--idempotency-key` is required; hooks derive it from stable harness session and
  turn identifiers, and the broker never guesses one.
- **Targeting** — deferred interactions list and explicitly target active reply-capable devices
  (registered iPhones and macOS companions; revised 2026-08-20 after PR #31) so
  `accepted > 0` refers to a reply-capable surface.
- **Service safety** — install writes absolute executable paths, removes ambient token/API variables,
  and fails closed when Linux lingering is disabled.
- **Distribution** — the broker is a private workspace package in v1; its service points to the
  reviewed installed artifact.
- **Heuristic convention** — strict `Question for user:` final marker, offline fixtures, zero false
  positives before enablement.
