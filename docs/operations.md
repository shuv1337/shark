# SHark v1 operations

External Apple, Expo, DNS, vault, backup, and deployment-transport setup is tracked in
[`provisioning-gates.md`](./provisioning-gates.md). Treat every unresolved item there as a release
gate.

## Architecture

`shark.shuv.dev` is a private single-operator web/API origin. exe.dev terminates HTTPS and proxies
to loopback-bound port 8787 on `shark-prod`. SQLite persists in the named `shark-data` volume.
Ordinary notifications use Expo Push Service; Live Activity start, update, and end pushes use
direct APNs credentials.

The production environment must set `NODE_ENV=production`, `DEPLOYMENT_MODE=self_hosted`, the exact
Apple allowlist, a unique Better Auth secret, complete Apple and APNs credential groups, an Expo
server access token, production APNs mode, and the frozen SHark bundle identifiers. Startup fails
closed when the matrix is incomplete. `TRUSTED_CLIENT_IP_HEADER` remains unset for exe.dev v1.

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

The command revokes Apple grants and persisted access but preserves account data. Use the separate
authenticated account-deletion flow only for permanent deletion.

## Backup and restore

Before every non-first deployment, the operator promotion helper stops the app, checkpoints the WAL,
copies the main SQLite file, opens the copy read-only, requires `integrity_check = ok`, verifies the
exact migration timestamp/count and required table set, then requires a verified encrypted Restic
snapshot before starting the new image.

The rsync.net repository suffix is `repos/shark-prod`. Nightly snapshots run at 02:00
`America/Los_Angeles`; retention is 7 daily, 4 weekly, and 6 monthly. The Restic password exists
only in Bitwarden, so Bitwarden recovery is an explicit disaster-recovery
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
application and backup secrets through separate Bitwarden machine accounts with disjoint direct
secret grants. It records the image
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
- The running container image ID matches the release provenance.
- The latest nightly/pre-deploy Restic snapshot is verified.
- Disk pressure, container restarts, and the capped local log files are healthy.
- Expo receipts are reviewed and `DeviceNotRegistered` tokens are deactivated.

Never retain emails, tokens, webhook URLs, push identifiers, OAuth codes, callback credentials,
private keys, or notification/reply content in Git, CI output, logs, screenshots, or verification
records.
