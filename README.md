# SHark

SHark turns webhooks into clean, source-branded notifications on iPhone, Apple Watch, macOS, and
the web. Connect CI jobs, agents,
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

- Sends rich native Apple and browser notifications from a simple webhook.
- Gives each service its own name, avatar, destination URL, and secret endpoint.
- Keeps complete notification, interaction, and Live Activity history in synchronized iOS and web
  inboxes.
- Tracks delivery attempts and registered devices in the web dashboard.
- Supports approvals and text replies for agent workflows.
- Shows stateful task progress with Live Activities on the Lock Screen and Dynamic Island.
- Supports multiple devices and targeted delivery in the fixed self-hosted mode.
- Includes a native macOS menu-bar companion for inbox triage, approvals, replies, and direct APNs
  delivery.

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

## Teams and On-Call

Create a team to share web apps and page whoever is on call. Roles are owner, admin, and member.

```sh
sharkctl teams create "Acme"
sharkctl teams invite team_... --email teammate@example.com   # returns a 7-day join link
sharkctl apps share app_... --team team_...
sharkctl oncall create --team team_... --name Primary --members user_a,user_b --period weekly
sharkctl page ocg_... "API error rate above 20%" --dedup-key api-5xx
```

Every member approves sign-in to a team app for themselves; the SHark pass then includes `team_id`
and `team_role`, and removing someone from the team stops their passes immediately. A page goes to
the person on call (rotations hand off at a local time and follow DST), then escalates to the next
person and the whole group until someone acknowledges from the lock screen or the website. Webhooks
page by adding `"oncall": "ocg_..."` to the payload. Acknowledging is human-only; agents can raise
and resolve pages. Invitees still have to pass the server's sign-in allowlist. See the
[Teams](https://shark.shuv.dev/docs#teams) and [On-call](https://shark.shuv.dev/docs#oncall) docs.

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
this reviewed operator checkout. The skill's frontmatter `metadata.version` names the SHark release
it came from and matches the `sharkctl` version it was reviewed with, so an installed copy can be
compared with the checkout. `sharkctl` is the fork's canonical executable. The `HARK_*`
environment variables, token prefixes, and local `hark` config paths remain protocol-compatibility
identifiers so existing credentials and integrations continue to work.

## MCP

SHark runs a remote [MCP](https://modelcontextprotocol.io) server at `https://shark.shuv.dev/mcp`
(Streamable HTTP). Add the URL to your client; it signs in with OAuth, so there is no token to
paste.

```sh
claude mcp add --transport http shark https://shark.shuv.dev/mcp
```

OpenCode uses `{ "mcp": { "shark": { "type": "remote", "url": "https://shark.shuv.dev/mcp" } } }`
and Cursor uses `{ "mcpServers": { "shark": { "url": "https://shark.shuv.dev/mcp" } } }`.

The first tool call opens a browser: sign in with Apple (the email allowlist still applies),
review the permissions the client asks for, untick any you do not want, and approve. This is OAuth
2.1 per the MCP authorization spec: anonymous discovery documents at
`/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`, dynamic
registration for public clients, PKCE (S256), tokens bound to the `/mcp` resource, one-hour access
tokens, and refresh tokens when you allow "Stay connected". Registering a client grants nothing
without consent. Connected clients are listed on the dashboard, where **Disconnect** revokes them
immediately; removing an account from the allowlist also stops its clients on the next call.

OAuth scopes are the agent token scopes, minus the native companion scopes (`watch:*` and
`macos:*`), plus `offline_access`. A client that requests no scope gets everything except
`tokens:manage`. There is one tool per agent API operation,
including the board, and each runs through the same handler, validation, and scope check as its
`/api/agent` route. Human-only actions are never tools: answering prompts or board asks,
acknowledging or escalating pages, accepting team invites, approving app sign-in, and creating
tokens.

## License

SHark preserves Hark's source-available
[PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use is not permitted without a
separate license from the licensor.
