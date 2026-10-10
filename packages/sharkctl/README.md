# sharkctl

`sharkctl` sends SHark push notifications, asks approval/text questions, and controls finite agent
task Live Activities from Node.js 22 or newer.

```
sharkctl
├─ auth         login · logout · status
├─ notify       <body>                          one-shot push
│  └─ ask       <prompt> (--approval | --yes-no | --text)  push that elicits an answer
├─ interaction  get <id> · wait <id>
├─ activity     start · update · end · get · list
├─ permissions  setup · doctor · uninstall
├─ devices      list
├─ services     create · list
├─ apps         create · list · get · update · share · revoke · remove
├─ teams        list · create · get · rename · delete · leave · members · role
│               remove-member · invite · invites · revoke-invite
├─ oncall       list · me · get · create · update · override · remove-override
├─ page         <group_id> <title>                page whoever is on call
├─ pages        list · get · resolve
└─ board        ask · cancel · get · wait · answers · ack · work · done · note
```

Start a browser authorization flow and approve the requested scopes with your signed-in SHark account:

```sh
npm install --global sharkctl@0.6.0
sharkctl auth login
sharkctl auth status
sharkctl notify "Deploy finished ✅" --title "Deploy bot" --image https://example.com/bot.png \
  --url https://example.com/runs/1
sharkctl notify ask "Deploy production?" --approval --wait --timeout 15m --json
sharkctl notify ask "What should the release note say?" --text --device dev_... --poll
sharkctl services create --title "Release bot" --image https://example.com/bot.png
sharkctl activity start --key release-main --title "Release" --status "Building" --progress 0.1 \
  --accent-color '#FF9F0A'
sharkctl activity update release-main --status "Testing" --progress 0.7 \
  --accent-color '#64D2FF' --if-sequence 0
sharkctl activity end release-main --status "Complete" --progress 1 --if-sequence 1
sharkctl auth logout
```

Treat every successful `activity start` as an obligation to issue `activity end` on success,
failure, cancellation, or cleanup. Keep the returned activity ID or use a stable key, and give the
end request a stable idempotency key when it may be retried. Sending a normal notification does not
end or correlate with an activity. An update or end issued before iOS registers the per-activity
update token exits 0 with `updateTokenPending: true` and message `MissingUpdateToken`. SHark has
stored the transition. A stored end is replayed when that token arrives; a stored update is not
pushed later by itself. See Activity below.

Prefer MCP? The same operations, including the board, are available as tools from SHark's remote
MCP server at `https://shark.shuv.dev/mcp`, which signs in with OAuth instead of a token
([setup](https://shark.shuv.dev/docs#mcp)).

The upstream `harkctl` package is not the SHark fork. Existing SHark credentials remain usable
because `sharkctl` deliberately reads the same protected `hark` config file during the rename.

Login prints a short code and verification URL to stderr, opens the system browser when interactive,
polls at the server-provided interval, and atomically writes credentials to a mode-`0600` file.
`sharkctl auth status` reports only whether the current credentials authenticate; it deliberately
omits token identifiers, prefixes, scopes, and timestamps so captured command output is safe. The
default scopes support notifications, asks, Live Activities, listing devices/services, creating
webhook services, managing web apps, teams, and on-call without requesting `events:read`. Every requested scope is shown on the browser
authorization page before approval. Connected tokens appear under **Dashboard > Agent
connections**, where they can be revoked.

Use repeatable `--scope`, `--client-name`, and `--expires-in` to narrow or label access. `--no-open`
suppresses browser launch; `--open` explicitly enables it in non-interactive environments. `--json`
keeps stdout to one machine-readable object while browser instructions remain on stderr.

## Programmatic client

`sharkctl/client` is the only supported code import; `sharkctl/package.json` is also exported.
Deep imports into `sharkctl/src/` are unsupported and no longer resolve through the package's
exports map. The command-line entry point and its environment/config precedence are unchanged.

The client exports `RequestError`, `request`, `publicRequest`, `loadFileConfig`, `getAuthStatus`,
`listDevices`, `createNotification`, `createInteraction`, `getInteraction`, and `cancelInteraction`.
Creation helpers accept `{ idempotencyKey, signal }`; other helpers accept `{ signal }`.
They return the server's JSON without inventing delivery guarantees or retrying a mutation.
Callers must validate response shapes and reconcile ambiguous results before retrying.

For supervised services, `loadFileConfig(absolutePath)` reads an explicit regular, non-symlink
mode-0600 JSON file containing `token` and `apiUrl`. It ignores `HARK_TOKEN` and `HARK_API_URL` and
rejects a different ambient `HARK_CONFIG`. The API URL must be an HTTPS origin without user info,
query, fragment, or path; HTTP loopback origins are allowed for local tests. The optional `tokenId`
is config metadata, not proof of authenticated identity: call `getAuthStatus` before registering
work and persist the server's identity. Config files are limited to 64 KiB.

Client results and `RequestError.body` can contain private data. Do not log config objects, tokens,
response bodies, or raw remote error messages. Libraries expose these to their trusted caller;
the interactive CLI continues to apply its existing output rules.

## notify

`sharkctl notify <body>` sends a one-shot push to your registered iPhones. `--title` sets the sender
name (defaults to “SHark”), `--image` sets the avatar shown with the notification, `--url` is opened
when the notification is tapped, and repeatable `--device` routes to specific device IDs.
Use `--idempotency-key` for safe retries and `--stdin` to merge a JSON payload from stdin under any
explicit flags. The command exits `7` when no push was accepted.

`sharkctl notify ask <prompt>` sends a push that elicits an answer. Pass exactly one of `--approval`
(Approve/Deny buttons), `--yes-no` (Yes/No buttons), or `--text` (a short free-form reply). It
shares the appearance flags above
plus `--expires-in` (default `15m`). Without a waiting flag it returns the pending interaction
immediately; read the answer later with `interaction get` or `interaction wait`. With `--wait
[--timeout <duration>]` it blocks until the answer arrives or the timeout passes. With `--poll` it
waits at most 20 seconds to catch an instant answer and then returns. A timed-out poll or wait
does not end the prompt — it stays answerable on the phone until it expires, and
`sharkctl interaction wait <id>` resumes waiting at any time; `--poll` cannot be combined with
`--wait` or `--timeout`.

When `--wait --timeout` is given without an explicit expiry (`--expires-in` flag or
`stdin.expiresIn`), the prompt expiry is derived from the wait timeout so the prompt stays
answerable for as long as the caller intends to wait. The derived value is clamped to the server
range of 30 seconds through 24 hours, or 30 seconds through 8 hours for Live Activities. An
explicit expiry always wins over derivation, and `--poll` keeps its default 15-minute expiry.
A stderr warning is emitted whenever the wait timeout exceeds the effective expiry, because
waiting beyond expiry cannot produce an answer.

Inside `notify`, a first positional of exactly `ask` selects the subcommand. Everything after a bare
`--` separator is treated as positional, so `sharkctl notify -- ask` sends the literal body “ask”.

## interaction

`interaction get <id>` prints the current state and maps terminal states to exit codes.
`interaction wait <id> [--timeout <duration>]` long-polls until the interaction is answered,
canceled, or expired, or the timeout passes (default `60s`).

## services

`services create --title <title> [--image <url>] [--url <url>]` creates a persistent webhook
service and prints its full `webhookUrl` in the JSON response. The title and image become defaults
for notifications sent through that URL, while `--url` sets the default tap destination. Pass
`--stdin` to supply the service object as JSON. `services list` shows existing services without
printing their webhook credentials. Creating services requires `services:write`; existing CLI
logins created before this scope was added need to sign in again.

## apps

`apps create --name <name> --url <url> [--icon <url>]` registers a web app that opens full-screen in
the SHark iPhone app with a signed pass (see the Web apps section of the in-app docs). Creating an
app with an existing URL updates it and returns `created: false`. `apps list` and
`apps remove <app_id>` manage registered apps. `notify --app <app_id>` opens that app when the
notification is tapped; `--url` is optional and must stay on the app's origin. These commands
require the `apps:read` and `apps:write` scopes; logins created before those scopes existed need to
sign in again (`sharkctl auth login`).

`apps create --team <team_id>` adds the app to a team instead, and `apps share <app_id>
(--team <team_id> | --personal) [--no-notify]` moves an app you added into a team or back to your
own apps. Other members are notified (unless `--no-notify`) and each approves sign-in on their own
phone; their SHark pass then carries `team_id` and `team_role`. Adding an app to a team also
requires the `teams:write` scope; `apps share --personal` notifies nobody and needs only
`apps:write`.

## teams

Teams share web apps and on-call groups (scopes `teams:read` and `teams:write`). `teams create
<name>` makes you the owner; `teams list`, `teams get <team_id>`, and `teams members <team_id>`
read; `teams rename`, `teams delete` (owner), and `teams leave` manage it. `teams role <team_id>
<user_id> <owner|admin|member>` changes a role (`owner` transfers ownership; the previous owner
becomes an admin), and `teams remove-member <team_id> <user_id>` removes someone, which also stops
their sign-in to the team's apps and drops them from rotations; apps that member added go back to
their own apps. `teams invite <team_id> [--email <email>] [--role member|admin]` returns a 7-day
join link (`code` and `url`). With `--email`, only the account with that email (case-insensitive)
can accept, and a SHark user with it also gets a push. Accepting is human-only, in the app or on
the website, and the joining account must still pass the server's email allowlist. `teams invites`
and `teams revoke-invite <team_id> <invite_id>` manage links. SHark has no seat billing, so team size
is not limited.

## oncall and page

On-call groups belong to a team (scopes `oncall:read` and `oncall:write`; creating and editing
needs a team admin). `oncall create --team <team_id> --name <name> --members <user_id,...>
[--period daily|weekly] [--handoff HH:MM] [--timezone <zone>] [--starts-at <iso>]` sets up a
rotation (defaults: daily, 09:00, your local zone; the first member is on call now) with the
default escalation (next person after 5 minutes, the whole group 10 minutes later); pass
`--stdin` JSON for a custom `escalation`. `oncall update <group_id>` changes any of those fields,
keeping the rest. `oncall override <group_id> --user <user_id> --starts-at <iso> --ends-at <iso>`
puts someone on call for a window (members can only hand off time they are on call for, from now
on; a window partly covered by a later-starting override is refused, so split it around that) and
`oncall remove-override <group_id> <override_id>` removes it.
`oncall list --team <team_id>`, `oncall get <group_id>`, and `oncall me` show current and upcoming
shifts.

`page <group_id> <title> [--body <text>] [--url <url>] [--app <app_id>] [--dedup-key <key>]`
pages whoever is on call (or the whole group when nobody is) and escalates until someone
acknowledges. A repeat with the same `--dedup-key` merges into the open page. `notify <body>
--oncall <group_id>` does the same from `notify`, using `--idempotency-key` as the dedup key. Both
exit `7` when no push was accepted yet. The page still exists: it keeps escalating and SHark
retries the push, so do not raise it again (reuse the dedup key if you must re-send). `pages list --team <team_id> [--all] [--limit <n>]
[--cursor <c>]`, `pages get <page_id>`, and `pages resolve <page_id> [--note <text>]` follow up.
Acknowledging and escalating are deliberately human-only: an acknowledgement tells the team a
person is on it.

## board

`board` feeds the captain's board at `/board`: durable questions that outlive their push, work in
flight, and heads-up notes. It needs the `board:read` and `board:write` scopes, which the default
login does not request; sign in once per agent with
`sharkctl auth login --client-name "<Agent> (<host>)"` with `--scope board:read --scope board:write`
plus every default scope you still need (`--scope` replaces the defaults; it does not add to them), so
each agent has its own token and the board can say who asked.

`board ask --key <key> --title <title>` is an upsert: repeating it unchanged only records that the
agent still cares, changing the title, body, options, or links bumps the revision and sends one new
push (p0 and p1 only; `--priority p2` stays board-only, `--push none` always does). `--option` is
repeatable (`Label`, `id=Label`, or `Label:primary|destructive`, up to six), `--allow-text` accepts a
typed reply, `--kind todo` makes a single Done item, and `--link [kind=]https://…` attaches PR,
issue, or doc links. Bodies come from `--body-file`; pushes carry only the agent and title. The
agent gets the answer through `--wait`, `board wait --key`, `board get --key`, or `board answers
--since <cursor>`, and optionally through a callback registered with `--callback-url-env VAR
--callback-token-file <path>` (the token never appears on argv). Call `board ack --key` after
applying an answer so the board shows it landed. `board cancel --key` withdraws a question.

`board work --key <key> --title <title> --state <queued|in_flight|review|blocked>` upserts a work
item and counts as its heartbeat; items past `--heartbeat-ttl` (default 6h) show as stale. `board
done --key <key> [--verb merged|shipped|done|closed|reported]` moves it to Recently done, creating it
if needed with `--title`. `board note --key <key> <text>` keeps a heads-up note; `--clear` removes it.

Only the captain's signed-in browser or phone can answer; no token scope resolves an ask. Content
is screened locally and server-side for tokens, keys, and webhook URLs: link to them, never paste.

## activity

Activity commands accept flags or `--stdin` JSON. `activity update` merges only the fields you
pass: `--status` alone is valid, and so is `--status` with `--progress`. At least one field other
than `--if-sequence` is required (`--title`, `--status`, `--detail`, `--progress`, `--symbol`,
`--privacy`, `--accent-color`, `--style`, or `--stale-after`). An empty update fails locally and
exits 2. A rejected update or end prints up to eight `path: message` lines on stderr and does not
echo submitted values. Use `activity get <id|key>` and `activity list` to inspect state,
`--idempotency-key` for retries, and `--if-sequence` to reject stale updates. Progress is a number
from 0 to 1. `--accent-color` accepts `#RRGGBB`. `--style` on `activity start` and `activity update`
picks the widget layout: `standard` (default), `ring`, `hero`, `terminal`, or `steps`; app builds
that predate a style render the standard layout until updated. Activities default to an eight-hour
expiry and become stale after four hours without an update. Repeated `--device` targeting is
available in self-hosted mode, and SHark permits one active activity per device; pass `--replace` on
`activity start` to
silently end whatever occupies the device and take the slot (the response reports the count as
`replaced`). A `--key` becomes reusable once its activity ends, so `activity start --key deploy
--replace` works as a fixed-key restart. `activity get` shows whether an activity is still live.

`activity start` does not return an update token, and update/end have no token flag. The phone
creates the token after start and registers it with the server. An update or end before that
registration returns `accepted: 0`, `failed: 1`, `message: "MissingUpdateToken"`, and
`updateTokenPending: true` (exit 0). `accepted` stays 0 until APNs takes the push. The sequence in
the response has already moved forward, so a later update uses that sequence or omits
`--if-sequence`. Replaying the same idempotency key returns this stored result, including
`updateTokenPending`. There is no server delay that makes the next attempt succeed by itself. A
stored update is not delivered later on its own; the next push that has a token sends the stored
props. An end with the same message stays terminal and is replayed when the token registers. Do not
start a replacement activity to clear the error. `activity start` with no delivery, and a real APNs
rejection (`accepted: 0` without `updateTokenPending`), still exit 7. Once APNs rejects a registered
update token (for example `Unregistered` after the activity is dismissed on the phone), later
updates and ends keep reporting that reason and, when no other device accepts, exit 7 until the phone registers a new token.
When every delivery is already failed and has no update token, agent and webhook update and end
both skip those rows. The response is `accepted: 0`, `failed: 0`, without `updateTokenPending`,
and sharkctl exits 7. That stored end is not replayed when a token arrives later.

A `partial` activity is still live: keep updating it, and end it on the terminal path. A failed
sibling delivery does not pin the activity in `partial` after the remaining devices accept. Before
a progress update, run `activity get`. Continue while the status is `starting`, `active`, or
`partial`.

If an update or end reports `Live Activity is already terminal (<status>)`, stderr also prints
`status=<ended|expired|failed> endedAt=<iso-or-null> expiresAt=<iso-or-null>`. `<status>` is
`ended`, `expired`, or `failed`. `expired` means `expiresAt` has passed. `ended` means an explicit
end, a `--replace` takeover, or a resolved interactive prompt. `failed` means no device accepted
the start (that `activity start` exited 7), or a later update found no retryable device delivery.
SHark does not end an activity on a short timer. Restart with the same `--key` and `--replace` only
when the task is still running, the status is `ended` or `failed`, and `expiresAt` is still in the
future. If the restarted start itself exits 7, do not restart again: no device accepted it. Check
`sharkctl devices list` and the start `message` instead.

## permissions

Route permission requests from Claude Code, Codex, OpenCode V1, and OpenCode V2 to SHark:

```sh
sharkctl permissions setup all
```

Install or remove one integration at a time:

```sh
sharkctl permissions setup claude
sharkctl permissions setup codex
sharkctl permissions setup opencode
sharkctl permissions doctor
sharkctl permissions uninstall all
```

Permission setup requires a credential file created by `sharkctl auth login`; an environment-only
`HARK_TOKEN` is not sufficient. Setup and `doctor` check the same file credential and API origin
used by permission hooks, ignoring `HARK_TOKEN` and `HARK_API_URL` overrides.

The default login includes the required `notifications:send`, `interactions:create`, and
`interactions:read` scopes. A narrowed login must retain all three; setup and `doctor` identify any
missing scopes. `sharkctl auth status` still reports only `{ authenticated }` so captured output stays
safe; setup and doctor resolve scopes in-process and never print token identifiers or prefixes.

Claude Code and Codex use synchronous `PermissionRequest` hooks. After Codex setup, open `/hooks`
and trust the SHark hook. OpenCode setup installs both connectors: a V1 plugin shim for current V1
servers and a per-user macOS LaunchAgent for the shared V2 service.

Only an explicit SHark approval grants a request, and it grants it once. Denial, timeout,
authentication failure, network failure, malformed input, and no-device delivery all deny. Phone
prompts contain only the agent name, permission/tool name, project directory basename, and resource
count. Raw commands, patches, prompts, file contents, URLs, environment variables, transcript paths,
and absolute paths are not sent to SHark.

Setup merges existing Claude and Codex JSON atomically. Uninstall removes only SHark-owned hooks,
the V1 shim, and the V2 LaunchAgent; it never removes shared SHark credentials or unrelated agent
configuration. The OpenCode background connector currently requires macOS. Permission hooks use the
user-owned `hark` credential file and intentionally do not inherit `HARK_TOKEN` or `HARK_API_URL`.

## Configuration

As an advanced fallback, set `HARK_TOKEN` to a scoped token secret (for example one minted by
`sharkctl auth login` on another machine), or put `{ "token": "hark_..." }` in the OS config file
with mode `0600`:

- macOS: `~/Library/Application Support/hark/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/hark/config.json`
- Windows: `%APPDATA%\hark\config.json`

The default API is `https://shark.shuv.dev`. `sharkctl` is the canonical fork executable.
`HARK_API_URL`, `HARK_TOKEN`, token prefixes, and the `hark` config directory remain
protocol-compatibility names so existing credentials and integrations continue to work. Override
the API origin only when the operator explicitly trusts another self-host. Tokens are never
accepted on the command line or printed to stdout. All successful command output is one stable JSON
object; diagnostics use stderr.

Exit codes: `0` success/approved/yes/replied, `1` API error, `2` usage error, `3` authentication or
scope error, `4` timeout/canceled/expired, `5` denied/no, `6` network error, `7` no push accepted.

## Project inbox and account commands

Notifications accept `--project <name>`, `--summary <text>`, and `--markdown`. Bodies may hold
8,000 characters and 16 KiB of UTF-8; summaries hold 500 characters. Push previews are byte-fit
at transport time while the full body stays in the inbox. Interactive Live Activities also accept
`--style approval|shell|verdict|signal` with `notify ask --live-activity`.

- `inbox projects`, `inbox list [--project <id|unfiled>] [--unread] [--limit <n>] [--cursor <c>]`,
  and `inbox get <event:evt_id|notification:anot_id>` read the project inbox (`inbox:read`).
- `inbox read <id>`, `inbox unread <id>`, and `inbox read-all [--project <id|unfiled>]` require
  `inbox:write`. Read-all captures an opaque boundary so concurrent arrivals remain unread.
- `interaction list` reads pending prompts; agents cannot answer them.
- `activity feed [--filter all|notification|live_activity|response] [--page <n>]` requires the
  opt-in `events:read` scope and returns 20 history entries per page.
- `notify withdraw <id>` sends a silent removal command across supported devices, persists the
  result, and marks the inbox copy read. Replays do not resend. Removal on a device is best effort.
- `services get <id>`, `services update <id>`, `services rotate <id>`, and `services remove <id>`
  manage existing services. Rotation returns a secret webhook URL once and invalidates the old URL.
- `devices remove <id>` requires `devices:write`; device registration still requires the app.
- `apps create` accepts `--project`; `apps get`, `apps update`, and `apps revoke` manage existing
  apps. Updates accept `--name`, `--url`, `--icon` / `--no-icon`, and `--project` / `--no-project`.
  Moving origin clears consent. All SHark CLI success output remains JSON, including these commands.
- `billing` reports the fixed self-hosted entitlement (`billing:read`); there is no paid checkout.
- `tokens list` and `tokens revoke <id>` require opt-in `tokens:manage`. Agents cannot mint tokens.

New logins include inbox, device-write, and billing-read scopes; older credentials do not gain
scopes automatically. The authenticated `/api/agent/openapi.json` describes the full agent API,
including SHark's board routes. Read-state changes are shared with the original durable inbox.
