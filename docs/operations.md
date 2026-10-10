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
seconds of recorded work (`apps/website/src/server/lib/rate-windows.ts`). Each path checks the
windows early, before any side effect. The paths that push to people then check again in the same
synchronous better-sqlite3 transaction that inserts the counted row, so concurrent requests
cannot overshoot: webhook notifications and pages, agent notifications, interactions, agent pages
(`/api/agent/oncall/:id/pages` and `/api/agent/notifications` with `oncall`), and board ask
pushes. Each on-call group also accepts at most 10 new pages a minute, enforced the same way. The
guarantee assumes the deployed shape: one app process on one SQLite connection.

Accepted residuals, which remain check-then-act and can be overshot by a concurrent burst:

- Live Activity starts, updates, and ends, from agent tokens and activity webhooks. A start can
  end blocking activities before its rows are inserted, so reserving capacity first would mean
  moving those side effects into the transaction. These pushes reach only the owner's devices, each
  device holds one active activity, and updates and ends compare-and-swap the activity sequence, so
  a burst against one activity records one operation.
- Agent app sharing and team app creation check the agent budget but record nothing it counts.
  Team notices have their own per-person cap.

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
interaction and on-call page credentials, and MCP OAuth access tokens, refresh tokens, and
consents) but preserves account data. Re-admitting the address later requires new sign-ins and new
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
identity with the reviewed SHA and digest. The host anonymously pulls the public image, verifies
its repository, signer workflow, `main` ref, source SHA, hosted runner, and digest, then fetches
application and backup secrets through separate 1Password service accounts with disjoint vault
access. It records the image
ID and digest, pre-deploy snapshot ID, source SHA, and timestamp.

For rollback, stop the current container, select the previous recorded full SHA and image ID,
restore the matching pre-deploy database only when migrations are incompatible, start the previous
release, prove the running image ID, then verify readiness, authenticated dashboard access, and one
test notification. Keep rollback manual until a real drill succeeds.

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
  - `POST /api/auth/oauth2/token`, `/api/auth/oauth2/revoke`, `/api/auth/oauth2/introspect`, and
    `/api/auth/oauth2/public-client-prelogin` authenticate with a client ID, code, or token
    instead of a session. An empty form body returns 400, and JSON returns 415.
  - `/mcp` without a valid bearer token returns 401 with a `WWW-Authenticate` challenge that points
    to the protected-resource metadata.
- The running container image ID matches the release provenance.
- The latest nightly/pre-deploy Restic snapshot is verified.
- Disk pressure, container restarts, and the capped local log files are healthy.
- Expo receipts and APNs responses are reviewed; expired native tokens are deactivated per target.
- `/sw.js` returns 200 with JavaScript content, and a signed-in browser can enable, test, disable,
  and re-enable notifications without creating duplicate active subscriptions.
- Web Push responses with an expired subscription status deactivate only that browser target; they
  do not prevent delivery to healthy iPhone or browser targets.
- A signed macOS app can complete device-code authorization, register its APNs token, refresh the
  server-backed inbox, and submit each approval/reply at most once. Private-preview mode must redact
  APNs alert content and omit notification actions.

Never retain emails, tokens, webhook URLs, push identifiers, OAuth codes, callback credentials,
private keys, or notification/reply content in Git, CI output, logs, screenshots, or verification
records.
