# SHark

SHark turns webhooks into clean, source-branded iPhone notifications. Connect CI jobs, agents,
scripts, monitoring tools, or anything else that can send an HTTP request.

SHark is a minimally rebranded, self-hosted fork of
[Hark](https://github.com/R44VC0RP/hark), pinned initially from upstream commit
`0c0d4e3de0752ee91d2a17dee83a313f6863d6a8`. It is operated as a personal,
noncommercial service at `https://shark.shuv.dev`.

## Quick Start

Requires [Node.js 22 or newer](https://nodejs.org/).

1. Install the SHark skill from this reviewed checkout:

   ```sh
   npx skills add . --skill shark --global
   ```

2. Install the SHark CLI from this reviewed checkout:

   ```sh
   pnpm --filter sharkctl link --global
   ```

3. Authenticate it with your SHark account:

   ```sh
   sharkctl auth login
   ```

4. Ask your agent:

   ```text
   What can SHark do?
   ```

Your agent can now notify your iPhone, request approvals or text replies, show task progress with
Live Activities, and create webhook services for external systems.

## What SHark Does

- Sends rich iOS notifications from a simple webhook.
- Gives each service its own name, avatar, destination URL, and secret endpoint.
- Tracks delivery attempts and registered devices in a web dashboard.
- Supports approvals and text replies for agent workflows.
- Shows stateful task progress with Live Activities on the Lock Screen and Dynamic Island.
- Supports multiple devices and targeted delivery in the fixed self-hosted mode.

## Webhook Setup

1. Sign in at [shark.shuv.dev](https://shark.shuv.dev).
2. Register your iPhone with the SHark app.
3. Create a service and copy its secret webhook URL.
4. Send it a JSON request.

## Send a Notification

```sh
curl -X POST 'https://shark.shuv.dev/hooks/whk_your_token' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "GitHub",
    "body": "Production deployed successfully.",
    "url": "https://github.com/acme/app/actions"
  }'
```

Only `body` is required.

| Field | Description |
| --- | --- |
| `body` | Notification text. |
| `title` | Optional sender-name override. |
| `imageUrl` | Optional public HTTPS avatar URL. |
| `url` | Optional destination opened when tapped. |
| `deviceIds` | Optional routing to specific devices. |

Successful requests return an event ID and the number of push requests accepted for delivery:

```json
{
  "ok": true,
  "eventId": "evt_...",
  "delivered": 1
}
```

Use an `Idempotency-Key` header when retrying requests to prevent duplicate notifications.

## Live Activities

Start a stateful Live Activity using the same service webhook token:

```sh
curl -X POST 'https://shark.shuv.dev/hooks/whk_your_token/live-activities' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Deploy #184",
    "status": "Building",
    "progress": 0.25,
    "symbol": "build",
    "accentColor": "#FF9F0A"
  }'
```

The response includes an `activityId`. Use it to update or end the activity:

```text
PATCH /hooks/:token/live-activities/:activityId
POST  /hooks/:token/live-activities/:activityId/end
```

Updates accept partial state such as `status`, `detail`, `progress`, `symbol`, and `accentColor`.
SHark allows one active SHark Live Activity per device; pass `replace: true` on start to silently end
whatever occupies the device and take the slot. Starting an activity may alert the user, but
progress updates are silent by default. High-priority updates control delivery speed, not sound or
haptics.

To contribute a genuinely new Live Activity layout, including no-simulator testing and every public
API, widget, CLI, and docs touchpoint, see
[Contributing a Live Activity template](./CONTRIBUTING_LIVE_ACTIVITY_TEMPLATES.md).

## Agent Workflows

The [`sharkctl`](./packages/sharkctl) CLI can send one-shot notifications, ask for approvals or short
replies, and manage Live Activities from scripts or AI agents.

```sh
sharkctl auth login
sharkctl notify "Deploy finished ✅" --title "Deploy bot"
sharkctl notify ask "Deploy production?" --approval --wait
sharkctl activity start --title "Release" --status "Building" --progress 0.1
```

The installable [`shark` agent skill](./skills/shark/SKILL.md) follows the open Agent Skills format
and supports OpenCode, Claude Code, Codex, Cursor, and other compatible agents. Install it only from
this reviewed operator checkout. `sharkctl` is the fork's canonical executable. The `HARK_*`
environment variables, token prefixes, and local `hark` config paths remain protocol-compatibility
identifiers so existing credentials and integrations continue to work.

## License

SHark preserves Hark's source-available
[PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use is not permitted without a
separate license from the licensor.
