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
├─ devices      list
└─ services     create · list
```

Start a browser authorization flow and approve the requested scopes with your signed-in SHark account:

```sh
npm install --global sharkctl@0.4.1
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
end or correlate with an activity. If an end initially reports `MissingUpdateToken`, SHark retains
the terminal state and replays it when iOS registers the activity update token late.

The upstream `harkctl` package is not the SHark fork. Existing SHark credentials remain usable
because `sharkctl` deliberately reads the same protected `hark` config file during the rename.

Login prints a short code and verification URL to stderr, opens the system browser when interactive,
polls at the server-provided interval, and atomically writes credentials to a mode-`0600` file.
`sharkctl auth status` reports only whether the current credentials authenticate; it deliberately
omits token identifiers, prefixes, scopes, and timestamps so captured command output is safe. The
default scopes support notifications, asks, Live Activities, listing devices/services, and creating
webhook services without requesting `events:read`. Every requested scope is shown on the browser
authorization page before approval. Connected tokens appear under **Dashboard > Agent
connections**, where they can be revoked.

Use repeatable `--scope`, `--client-name`, and `--expires-in` to narrow or label access. `--no-open`
suppresses browser launch; `--open` explicitly enables it in non-interactive environments. `--json`
keeps stdout to one machine-readable object while browser instructions remain on stderr.

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

## activity

Activity commands accept flags or `--stdin` JSON. Use `activity get <id|key>` and `activity list` to
inspect state, `--idempotency-key` for retries, and `--if-sequence` to reject stale updates. Progress
is a number from 0 to 1. `--accent-color` accepts `#RRGGBB`. `--style` on `activity start` and
`activity update` picks the widget layout: `standard` (default), `ring`, `hero`, `terminal`, or
`steps`; app builds that predate a style render the standard layout until updated. Activities default to an eight-hour
expiry and become stale after four hours without an update. Repeated `--device` targeting is
available in self-hosted mode, and SHark permits one active activity per device; pass `--replace` on
`activity start` to
silently end whatever occupies the device and take the slot (the response reports the count as
`replaced`). A `--key` becomes reusable once its activity ends, so `activity start --key deploy
--replace` works as a fixed-key restart.

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
