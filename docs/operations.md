# SHark v1 operations

External Apple, Expo, DNS, vault, backup, and deployment-transport setup is tracked in
[`provisioning-gates.md`](./provisioning-gates.md). Treat every unresolved item there as a release
gate.

## Architecture

`shark.shuv.dev` is a private single-operator web/API origin. exe.dev terminates HTTPS and proxies
to loopback-bound port 8787 on `shark-prod`. SQLite persists in the named `shark-data` volume.
Ordinary iPhone notifications use Expo Push Service, browser notifications use standards-based Web
Push with VAPID credentials, and the native macOS companion plus Live Activity start, update, and
end pushes use direct APNs credentials. macOS uses topic `APNS_MACOS_BUNDLE_ID` (default
`dev.shuv.shark.macos`) and the same team APNs signing key. The root-scoped service worker is a
static production asset and must remain available at `/sw.js`; do not cache authenticated API
responses in it.

The production environment must set `NODE_ENV=production`, `DEPLOYMENT_MODE=self_hosted`, the exact
Apple allowlist, a unique Better Auth secret, complete Apple and APNs credential groups, an Expo
server access token, a complete VAPID key/subject group, production APNs mode, and the frozen SHark
bundle identifiers. Startup fails closed when the matrix is incomplete.

Client IPs key the per-client rate limits (Better Auth, including anonymous OAuth client
registration at `/api/auth/oauth2/register`, device authorization, and invite previews). Cloudflare
is DNS-only, so `CF-Connecting-IP` is client-controlled and must not be trusted. In production,
`X-Forwarded-For` reaches the app with two entries, both the real client IP, after any value the
client sent. Only the rightmost entry is the client address seen by exe.dev; earlier entries can be
forged. Production therefore sets `TRUSTED_FORWARDED_FOR_HOPS=1` and leaves
`TRUSTED_CLIENT_IP_HEADER` unset, so the app trusts only the rightmost entry. The reviewed
`compose.yaml` defaults the value to `1` and `shark-materialize-secrets` writes it. Both are
operator-installed copies: until `/etc/shark/compose.yaml` and
`/usr/local/sbin/shark-materialize-secrets` are reinstalled from the reviewed revision, the running
service keeps the previous behavior (Better Auth trusts only a single-entry `X-Forwarded-For`, so
callers that forge one share a bucket, and the app's own per-client limits stay global). Never set
the value above the real number of appending proxies, or a forged entry becomes trusted.

The server also sweeps OAuth storage hourly: expired access and refresh tokens, and anonymous
registered clients older than a day that never gained a consent, token, or grant.

## Per-minute rate limits

`SERVICE_RATE_LIMIT_PER_MINUTE` bounds each webhook service and each agent token (the requester
window), and `ACCOUNT_RATE_LIMIT_PER_MINUTE` bounds an account's total, both over the last 60
seconds of recorded work. `apps/website/src/server/lib/rate-windows.ts` holds the one definition
every surface uses:

- Service window: the webhook service's events, Live Activity operations, and pages.
- Requester window: the agent token's Live Activity operations, interactions, one-shot
  notifications (including board ask pushes and each board push retry), and pages.
- Account window: every event from the owner's services, every interaction not tied to an event
  (a webhook notification with `response` counts once, as its event), every agent notification,
  board push retry, and page, and every Live Activity operation not tied to an interaction (the
  interaction already counts).

Each path checks the windows early to answer cheaply. Every counted surface then checks again in
the same synchronous better-sqlite3 transaction that inserts the counted row, so concurrent
requests cannot overshoot them: webhook notifications (with the `response` interaction in the same
transaction) and pages, agent notifications, interactions, agent pages
(`/api/agent/oncall/:id/pages` and `/api/agent/notifications` with `oncall`), board ask pushes,
and Live Activity starts, updates, and ends from agent tokens and activity webhooks. A Live
Activity start runs admission, then ends any blocking activity, then inserts its activity and
operation rows, all in one transaction, and sends pushes only after it commits, so a refused start
ends no live activity and sends nothing (it may still mark rows that were already past expiry as
ended). If a blocker changed after the start planned its replacement, the transaction ends it from
its current row, or rolls back with `409 ACTIVE_ACTIVITY_CONFLICT`; updates and ends still
compare-and-swap the activity sequence. `rate-windows.guard.test.ts` fails if a new insert into a
counted table appears outside the known admitted call sites. A request with an `Idempotency-Key`
skips the early check and, inside the
transaction, replays a stored twin before admission, so a raced duplicate replays instead of
answering `429`. A project named by a webhook or agent notification is created in that transaction
only after admission, so a refused notification leaves no project behind.

A board push retry of a failed attempt is admitted in the same way and records its own
`agent_notification_retry` row, so every attempt counts in the window it was made in and earlier
attempts keep their usage. Retry rows only matter for 60 seconds, so the board sweeper deletes
those older than an hour, in batches of 1000 each minute. The transaction also claims the attempt with a fresh claim id, and only
that claim may record the outcome. A revision with an attempt still sending in this process is
never reclaimed; one stuck in `processing` for two minutes and not running here (for example after
a restart) is treated as abandoned and may be retried. Each on-call group also accepts at most 10
new pages a minute, enforced the same way. These guarantees assume the deployed shape: one app
process on one SQLite connection.

Accepted residuals:

- Agent app sharing and team app creation check the agent budget but record nothing it counts.
- Team notices (invites, shared apps, on-call override notices) record an agent notification for
  each recipient outside the windows; they have their own per-sender cap instead.

## Admission and identity

Sign in with Apple is the only provider. Add exactly the verified real or Apple relay email returned
for the operator; comparisons are trimmed and case-insensitive, but aliases and relay mappings are
never inferred. The Apple provider subject remains the stable account identity.

Removing an email from `ALLOWED_EMAILS` blocks new and existing browser sessions, API tokens,
webhooks, interaction credentials, device authorization, and Live Activity credentials on their
next request. Then run the bundled offboarding command in the production image:

```sh
DEPLOY_GIT_SHA='<deployed-full-sha>' \
SHARK_IMAGE='ghcr.io/shuv1337/shark@sha256:<deployed-digest>' \
docker compose --env-file /home/exedev/shark/.env --file /etc/shark/compose.yaml \
  run --rm --no-deps \
  -e OFFBOARD_EMAIL='exact-apple-email@example.com' \
  shark node dist/operator/offboard-user.js
```

The command revokes Apple grants and persisted access (sessions, API tokens, webhooks, devices,
interaction and on-call page credentials, and MCP OAuth access tokens, refresh tokens, consents,
and unexchanged authorization codes) but preserves account data. Re-admitting the address later requires new sign-ins and new
MCP consent. Use the separate
authenticated account-deletion flow only for permanent deletion.

## Backup and restore

Before every non-first deployment, the operator promotion helper stops the app, checkpoints the WAL,
copies the main SQLite file, opens the copy read-only, requires `integrity_check = ok`, verifies the
exact migration timestamp/count and required table set, then requires a verified encrypted Restic
snapshot before starting the new image.

The rsync.net repository suffix is `repos/shark-prod`. Nightly snapshots run at 02:00
`America/Los_Angeles`; retention is 7 daily, 4 weekly, and 6 monthly. The Restic password exists
only in the isolated 1Password backup vault, so 1Password recovery is an explicit disaster-recovery
dependency.

Quarterly, restore a selected snapshot into a disposable Compose project. Verify migration state,
integrity, account, services, devices, events, interactions, and Live Activity records. Start the
restored service with isolated credentials, verify readiness, then destroy the disposable project.
Expired push tokens are expected; reopening each iPhone re-registers it.

## Deployment and rollback

The manual GitHub workflow on `main` verifies the monorepo, publishes
`ghcr.io/shuv1337/shark:<full-sha>`, and attests the exact image digest. It has no VM credential and
does not deploy. The operator invokes the production helper through their existing exe.dev
identity with the reviewed SHA and digest, detached from the SSH session with `setsid nohup` (see
`deploy/README.md`). Abort a detached run with `SIGTERM` to its process group; it ignores `SIGHUP`.
If the helper fails, or receives `SIGINT` or `SIGTERM`, after it starts to stop the current
container and before it records the new release, it waits for the stop and restarts the previous
release. A `SIGHUP` to an attached run after the new container has started leaves that release
running but unrecorded, because its migrations may already have run; during the new `compose up`
it does so only if the service container is already running the new image. The host anonymously pulls the public image, verifies
its repository, signer workflow, `main` ref, source SHA, hosted runner, and digest, then fetches
application and backup secrets through separate 1Password service accounts with disjoint vault
access. It records the image
ID and digest, pre-deploy snapshot ID, source SHA, and timestamp.

For rollback, stop the current container, select the previous recorded full SHA and image ID,
restore the matching pre-deploy database only when migrations are incompatible, start the previous
release, prove the running image ID, then verify readiness, authenticated dashboard access, and one
test notification. Rollback stays a manual operator step; the schema-compatible case was drilled
on 2026-10-10 (`docs/verification.md`), and a rollback that needs the database restore has not
been.

## Manual checks

SHark v1 has no proactive monitoring or alerts. Check these manually after deployment and during
operator review:

- `https://shark.shuv.dev/api/health` returns 200 and only `{"ok":true}`.
- Anonymous `/`, `/docs`, `/privacy`, `/terms`, `/dashboard`, and `/cli/authorize` are denied.
- The OAuth endpoints for the MCP server are intentionally anonymous. They must not return account
  data:
  - `GET /.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`,
    `/.well-known/oauth-authorization-server`, and
    `/.well-known/oauth-authorization-server/api/auth` return 200 discovery metadata only.
  - `POST /api/auth/oauth2/register` accepts dynamic client registration. It is rate-limited per
    client IP and grants nothing without consent. An empty body returns 400.
  - `POST /api/auth/oauth2/token`, `/api/auth/oauth2/revoke`, and `/api/auth/oauth2/introspect`
    authenticate with a client ID, code, or token instead of a session. An empty form body returns
    400, and JSON returns 415.
  - `POST /api/auth/oauth2/public-client-prelogin` accepts JSON and verifies a signed
    `oauth_query` instead of a session. An empty JSON body returns 400, a `client_id` that
    differs from the signed query's returns 400, and valid JSON with a validly signed query for
    the same client returns 200 with the client's public registration fields, without
    `contacts`.
  - `/mcp` without a valid bearer token returns 401 with a `WWW-Authenticate` challenge that points
    to the protected-resource metadata.
- The team invite preview `GET /api/team-invites/:code` returns 401 without a session. Signed in,
  a valid code returns only the team name, inviter name, role, member count, and expiry, with
  `Cache-Control: no-store`. An unknown code returns 404, and more than 30 requests a minute from
  one client returns 429. The access log records it as `/api/team-invites/:code`. See
  `docs/upstream-delta.md` for why each anonymous exception is acceptable.
- The running container image ID matches the release provenance.
- The latest nightly/pre-deploy Restic snapshot is verified.
- Disk pressure, container restarts, and the capped local log files are healthy.
- Expo receipts and APNs responses are reviewed; expired native tokens are deactivated per target.
- `/sw.js` returns 200 with JavaScript content, and a signed-in browser can enable, test, disable,
  and re-enable notifications without creating duplicate active subscriptions.
- Web Push responses with an expired subscription status deactivate only that browser target; they
  do not prevent delivery to healthy iPhone or browser targets. A push service that resolves to a
  non-public address, fails DNS, or doesn't finish resolution plus the request within 10 seconds
  is reported as a delivery error for that target and leaves the subscription active.
- A signed macOS app can complete device-code authorization, register its APNs token, refresh the
  server-backed inbox, and submit each approval/reply at most once. Private-preview mode must redact
  APNs alert content and omit notification actions.

Never retain emails, tokens, webhook URLs, push identifiers, OAuth codes, callback credentials,
private keys, or notification/reply content in Git, CI output, logs, screenshots, or verification
records.
