# Intentional SHark upstream delta

SHark is a personal, noncommercial fork of Hark pinned initially at
`0c0d4e3de0752ee91d2a17dee83a313f6863d6a8`. Keep this delta narrow when reviewing upstream
changes.

## Deliberate differences

- Product-facing name, private origin, icon, legal language, and operator documentation use SHark.
- Apple, Expo, App Store Connect, OAuth, push, App Group, and extension identities are
  operator-owned.
- Apple is the only authentication provider. A normalized exact-email allowlist is a current
  authorization boundary for sessions and every durable credential.
- Removing an address offboards access without deleting account data. Permanent deletion is
  separate.
- The commercial/billing runtime, Autumn integration, public marketing, pricing, Google sign-in,
  metering, checkout, and portal surfaces are absent.
- One fixed self-hosted entitlement enables multiple devices, routing, interactions, and Live
  Activities. Abuse limits are 300 requests per service per minute and 1,500 per account per minute.
- Only `/api/health` is anonymously readable. Human-facing pages, docs exports, assets, and source
  links require an admitted session. The exceptions are machine-facing and return no account
  content: public signing keys (`/.well-known/jwks.json`), the MCP OAuth endpoints, and the team
  invite preview. They are listed with what each one exposes in the teams and MCP sections below.
- Production uses the `shark-prod` deployment, attested immutable GHCR digests,
  1Password-fed secrets, exact-schema SQLite checkpoint validation, encrypted Restic snapshots,
  and operator promotion with no GitHub VM credential.
- The `expo-widgets` patch is retargeted to the current SDK 57 patch line and keeps
  `https://shark.shuv.dev/api/live-activity-interactions/` as the Live Activity response
  endpoint. Do not copy Hark's `hark.ryan.ceo` URL from upstream patches.
- Delivered notification withdrawal fans out silent commands to Expo, web push, and macOS.
  Upstream Hark is iOS-only. SHark also cancels a still-pending interaction, projects
  `withdrawn` / `withdraw_partial` through the durable inbox, and synchronizes read state between source rows and `inbox_item.readAt`. Notification Center removal remains best effort.
- Coding-agent permission bridges (`sharkctl permissions`) are ported from Hark with SHark names
  and paths: LaunchAgent `dev.shuv.shark-permission-bridge`, state under
  `~/Library/Application Support/SHark/permission-bridge`, and no Hark artwork URLs. Setup and
  doctor resolve required scopes in-process because public `auth status` stays metadata-stripped.
  OpenCode V2 discovery is a local helper rather than `@opencode-ai/client`.
- Accepted CLI behavior delta: with `sharkctl notify ask --wait --timeout X` and no explicit expiry
  (`--expires-in` flag or `stdin.expiresIn`), sharkctl derives the interaction expiry from the wait
  timeout, clamped to the server range of 30 seconds through 24 hours (8 hours for an effective
  Live Activity keyed on the flag or `stdin.presentation === "live_activity"`). Upstream Hark
  defaults the expiry to 15 minutes in that case. Explicit expiry still wins, `--poll` behavior is
  unchanged, and a stderr warning fires when the wait timeout exceeds the effective expiry.
- The supported `sharkctl/client` import shares the CLI's request/error primitives with local
  integrations. The package exports only `./client` and `./package.json`; previously possible,
  unsupported deep source imports are no longer externally resolvable. The CLI executable is
  unchanged. A separate protected-file loader ignores ambient token/API overrides, rejects a
  conflicting `HARK_CONFIG`, and requires an explicit mode-0600 config and HTTPS origin (HTTP
  loopback is allowed for local testing). Interactive CLI config precedence is unchanged.
- SHark iOS optionally forwards default notification taps to an operator-configured SSHuv HTTPS
  prefix ending in `/v1/`, with a bounded opaque reference. It is disabled without that build
  setting. Other notification taps keep inbox-first routing, and action responses keep the durable
  reply queue. Cold/warm duplicate default-tap callbacks are coalesced. See
  [the handoff candidate and physical gates](agent-reply-routing/ios-handoff.md).

- The private `@hark/shark-broker` package adds `sharkd`, a versioned trusted local API, protected
  SQLite outbox/recovery, and user-service definitions. Its staged adapter supports the verified
  shuvcode/OpenCode v2 protocol only; Codex/Claude fail closed. This adds no harness-aware server
  state and changes no SHark API or credential boundary. See [broker setup and limits](../packages/shark-broker/README.md).

- Web apps and signed passes are ported from upstream Hark `8e14ede`/`a84813a` with the
  upstream project link and apps home screen, retaining the SHark font and theme: `app` and `app_signing_key` tables,
  nullable `app_id` on `event` and `agent_notification`, `/api/agent/apps`, `/api/apps`, the
  anonymous `/.well-known/jwks.json`, `sharkctl apps` and `notify --app`, and the iPhone web view.
  The JWT `typ` `hark-pass+jwt` and the `app_` id prefix stay as protocol identifiers.
- The board (`/board`, `/api/board`, `/api/agent/board`, `sharkctl board`) is fork-only: four
  `board_*` tables, `board:read`/`board:write` scopes, a per-user server-sent event stream, and a
  callback worker beside the interaction one. Upstream tables are referenced, never altered. No
  token scope can answer an ask; answers come only from an admitted same-origin session.
- Integration 2026-10-08 merges upstream `d9237a9` as a real second parent, superseding the
  earlier selective-port-only policy. The website visual redesign is excluded. Existing migrations
  `0000` through `0022` remain byte-for-byte unchanged; all missing upstream schema changes are
  consolidated into additive `0023_upstream_project_inbox` against SHark's actual schema.

## Full upstream integration, 2026-10-08

Included: project grouping, full notification bodies and summaries, markdown/link rendering, read
state and opaque mark-all-read boundaries, pending prompts and activity history, app metadata and
apps-as-home navigation, alternate icons, modular standard and interactive Live Activity layouts,
service/device/app/token management APIs and CLI commands, fixed-entitlement lookup, and authenticated
OpenAPI. The original durable inbox and board remain accessible. Project inbox read state is synced
both ways, including interactive webhook deliveries and lazily materialized durable rows.

Deliberate merge resolutions:

- Keep the existing website client, CSS, public assets, private shells, marketing removal, and
  private documentation surfaces. Server/API code under `apps/website` is included because the
  iOS and CLI functionality depends on it.
- Keep SHark names/artwork, adaptive red/navy theme, Apple-only allowlist auth, operator signing and
  bundle configuration, version/build settings, local analytics, deployment/backup tooling, broker,
  and newer dependency/Expo patch versions. Do not import upstream broadcast or product analytics.
- Add alternate icons using the SHark mark, not upstream solid-color icons. The old solid-color
  generator is excluded; `brand:generate` owns every generated icon.
- Keep multi-platform delivery and withdrawal, HTTP(S)-only tap destinations, SSHuv handoff,
  durable inline replies, late Live Activity token replay/diagnostics, and existing wait/expiry
  semantics. Agent withdrawal uses the same claim/rollback/idempotent lifecycle as webhook withdrawal.
- Keep transport-time push fitting: one oversized target must not prevent other transports from
  settling. Long bodies remain intact in storage and summaries feed push previews.
- Keep stable JSON CLI output (upstream human-readable app output is not adopted), native protocol
  identifiers, `sharkctl` package location, and the `skills/shark` skill.
- OpenAPI requires an admitted API credential. Billing returns the fixed self-host entitlement.
  Token management cannot mint credentials, agent scopes cannot answer prompts or approve app consent.

This branch is an integration candidate. Automated validation does not establish physical iPhone
rendering, notification removal, app-icon switching, or production readiness. Validation: 734 automated tests passed (2 existing broker tests skipped), workspace type checks,
production build, iOS Hermes export, lint (one existing optional-chain warning), and deterministic
brand checks passed. Existing migration files and website frontend were verified unchanged.

Native app rebuilding
is required for the new alternate-icon plugin. Deploy and device acceptance remain separate work.

## Teams and on-call integration, 2026-10-09

Merges upstream through `86fecac` (teams, invites, team apps, on-call groups, rotations,
overrides, escalating pages, page acknowledgement from the Lock Screen). `d9237a9` is recorded as
an ancestor because the 2026-10-08 integration landed as a squash.

Deliberate merge resolutions:

- Upstream's `0021_teams_oncall` is not adopted: it collides with SHark's `0021` and rebuilds
  `agent_notification` against upstream's schema. The same tables are authored as additive
  `0024_upstream_teams_oncall` against SHark's schema. Its `agent_notification` rebuild copies
  `rowid` (project-inbox read cursors depend on it), drops the durable inbox triggers first and
  recreates them afterwards, and lets the insert trigger materialize token-less notices (team
  invites, shared apps) with `source_name`.
- No seat billing: `team-billing.ts` keeps upstream's exports but reports a free, unlimited plan,
  and checkout or portal calls fail with "Billing is not configured". Seat and pricing UI, docs, and
  the pricing page are removed. Team membership still requires an allowlisted Apple sign-in.
- Join links use `shark://join/<code>`; the iPhone app also accepts legacy `hark://join` links.
  The website `/dashboard/teams/:id` and `/join/:code` shells sit behind `requireAuth`.
- Upstream analytics (`trackAppEvent`), Google sign-in, and App Store links are not imported.
- The board and SHark scopes are kept alongside the new `teams:*` and `oncall:*` scopes, which are
  added to the default `sharkctl` login. Existing tokens must log in again to use them.
- Fork hardening on top of upstream: Lock Screen page credentials only work for recipients still on
  `ALLOWED_EMAILS`, offboarding overwrites them, and paging skips non-admitted members. Pages run
  the webhook and agent per-minute windows, count against the account window, and each group
  accepts at most 10 new pages a minute. Sharing an app (or creating one with `teamId`) from an
  agent token also needs `teams:write` and the agent budget, and each person can trigger at most
  10 team notices a minute. Request logs redact `/join/:code` and `/api/team-invites/:code`.
- Anonymous exception to the private origin: `GET /api/team-invites/:code` returns an invite
  preview without a session, so the join page can show what the invite is for before Apple
  sign-in. It returns the team name, the inviter's display name, the offered role, the team's
  member count, and the invite's expiry. It returns no email addresses, member list, or team ID.
  An unknown, used, or expired code returns 404. Responses are `no-store` and limited to 30 a
  minute per client IP and 600 a minute overall. The code is the secret: without it nothing is
  returned, and with it a person learns only what they need to decide whether to join. Accepting
  still requires an allowlisted session (`POST /api/team-invites/:code/accept`).

## MCP server integration, 2026-10-09

Merges upstream through `97b3a97`, adopting the OAuth-protected MCP server at `/mcp` (`186e543`)
and the skill's web app and MCP guidance (`44611b5`). The TestFlight/App Store link commits
(`c732d1b`, `97b3a97`), comped team seats (`2317509`), and the iOS 1.3 version bump (`4a49c28`) are
merged as history only; their changes are not applied.

Deliberate merge resolutions:

- Upstream's `0022_oauth_mcp` collides with SHark's `0022`; the identical additive SQL is
  `0025_upstream_oauth_mcp`.
- Consent is Apple-only and served behind `requireAuth`, so a signed-out visitor goes through
  `/login`. Sessions are already restricted to allowlisted accounts, and `/mcp` re-checks the
  owner's allowlist on every call, so removing an email stops its clients immediately.
- The Apple Watch and Mac companion scopes (`watch:*`, `macos:*`) are never OAuth scopes: they can
  answer prompts. Board scopes are grantable, and every board route has an MCP tool.
- Intentional anonymous exceptions, all of which return no account content:
  - Discovery documents: `/.well-known/oauth-protected-resource[/mcp]` and
    `/.well-known/oauth-authorization-server[/api/auth]`.
  - Dynamic client registration (`POST /api/auth/oauth2/register`), rate-limited to 5 a minute
    per client IP. Registration grants nothing without an allowlisted user's consent.
  - `POST /api/auth/oauth2/token`, `/api/auth/oauth2/revoke`, and `/api/auth/oauth2/introspect`.
    They take no session; a client authenticates with its client ID plus a PKCE-bound code, a
    refresh token, or the token being revoked or introspected.
  - `POST /api/auth/oauth2/public-client-prelogin`, which the consent page uses to show the
    requesting client's registered name, URI, logo, policy links, and contacts. It requires a
    validly signed authorize query (`oauth_query`), which anyone can obtain by starting an
    authorization. Better Auth 1.6.25 doesn't bind the body's `client_id` to that query, so a
    caller can read the same public registration fields for any client whose random ID it already
    knows. Those fields include the registered `contacts`, which can contain email addresses.

  `docs/operations.md` lists the response each one should give in its manual checks.
  `routes/mcp-oauth.integration.test.ts` runs the whole flow through the real Better Auth
  handler: registration, S256 PKCE, consent, code exchange and reuse, `/mcp`, refresh rotation
  and reuse detection, and revocation.
- `/api/oauth/clients` mutations require a same-origin request, like the other session routes.
- Better Auth rate limits read the client IP the app resolves from `TRUSTED_CLIENT_IP_HEADER` or
  `TRUSTED_FORWARDED_FOR_HOPS` (production: one exe.dev hop) per `docs/operations.md`. An hourly
  sweeper deletes expired OAuth tokens and day-old anonymous clients that were never connected,
  and offboarding deletes the user's OAuth tokens and consents.
- The MCP server name is `shark`; access and refresh token prefixes stay `hark_mat_` and
  `hark_mrt_` as protocol identifiers.
- MCP tools flatten each agent route's request body into tool arguments, so `board_ask` accepts
  `callback.url` and `callback.token` (`boardCallbackSchema` in `packages/contracts/src/board.ts`).
  An MCP client with `board:write` can therefore make the server POST an ask's resolution to a URL
  it chooses, exactly as an agent token can. This is a deliberate capability, with the same guards
  as the agent API. `isPublicHttpsUrl` is checked when the ask is written and again before each
  delivery in `lib/board-callbacks.ts`. It rejects non-HTTPS URLs, `localhost`, `.local`, and
  literal private, loopback, link-local, CGNAT, and IPv4-mapped addresses. Delivery uses
  `redirect: "manual"`, so a redirect can't send it to another host, and a 10-second timeout. The
  caller sees only the delivery status, the HTTP status code, or a short error, never the response
  body. The check is on the URL's hostname only: it doesn't resolve DNS, so a public name that
  resolves to a private address isn't blocked.
- Dependency footprint: `@modelcontextprotocol/sdk` is a production dependency of
  `@hark/website`. Per `pnpm-lock.yaml` it brings about 90 transitive packages, 54 of which
  nothing else in the website's production tree uses. They include `express@5`, `body-parser`,
  `qs`, `router`, `send`, `serve-static`, `cors`, `express-rate-limit`, `eventsource`,
  `cross-spawn`, `ajv`, and `ajv-formats`. SHark serves MCP through Hono with the SDK's
  web-standard transport, so none of the Express stack runs. The esbuild server bundle includes
  only the SDK's server and JSON-schema code (`ajv`, `ajv-formats`, `fast-uri`,
  `json-schema-traverse`, `zod-to-json-schema`, `content-type`). The runtime image installs only
  `@hark/website-runtime` (`better-sqlite3`, `expo-server-sdk`). Dependency and security reviews
  should still count the full set, because an advisory against it is reported against the
  lockfile and a future import could bundle it. Recheck with
  `pnpm --filter @hark/website why express` and an esbuild metafile.

## CLI and compatibility names

`sharkctl` is the canonical fork CLI and package. Keep `HARK_*`, `@hark/*`, the `hark` config
directory, SQLite names, token prefixes and hash-domain strings, notification category IDs,
`HarkAgentActivity`, webhook routes, DTOs, migrations, and `Hark-Callbacks/1` stable unless a
separate migration explicitly changes them. Also pin the HTTP 400 `Invalid device selection`
error literal: the broker permits device-selection replacement only for that exact pre-insertion
rejection. Its fixture must be updated deliberately if upstream wording changes.
These are protocol or persistence identities, not
visible incomplete branding.

## Upstream review

Before importing upstream changes, fetch upstream, inspect commits and the full diff, resolve the
small brand/config layer deliberately, then rerun the automated baseline and physical-device smoke
tests. Never merge an upstream change directly into production.
