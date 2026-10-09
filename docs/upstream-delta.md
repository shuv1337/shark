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
  links require an admitted session.
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
