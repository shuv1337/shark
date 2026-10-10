# SHark v1 verification ledger

This ledger records evidence without secrets, user content, private identifiers, or unredacted
logs. Unchecked release evidence keeps the goal active.

## Source baseline

- 2026-10-10: host CLI, broker, and skill install of SHark 1.0.0 from
  `dfe3a27f5ff04df9183db2768b2ebe3e959dcd7a` (#132, unified product version) on shuvbot (macOS,
  launchd `dev.shuv.shark.broker`) and shuvdev (Linux, user systemd `sharkd.service`). The
  production service was not touched.
  - Tarballs were packed on shuvbot from a clean detached checkout of the merge commit with
    `pnpm install --frozen-lockfile`, then copied to shuvdev and checked by hash:
    `sharkctl-1.0.0.tgz` (`e41320ce1d8806773a61f11d3cd01b27d2a738a1e5c6642141e4c285918367a4`) and
    `hark-shark-broker-1.0.0.tgz`
    (`abb99d08aeff75999c30538f569a5e957190dd01debfed1a91efaac01e251298`).
  - Before the change, both hosts ran `sharkctl` 0.5.0 and `sharkd` 0.1.0, with healthy services,
    empty `sharkd queue list`, and no status counts. shuvbot ran the
    `~/.local/lib/shark-broker/e405b22180a47ab55bb4070d585017f979bc9553/` bundle, and shuvdev ran
    `~/.local/lib/shark-broker/25e1649b18d1bac87b4475b74459ef3afd8537bb/`. Both are kept for
    rollback.
  - On each host, both tarballs were installed with `npm install` into
    `~/.local/lib/shark-broker/dfe3a27f5ff04df9183db2768b2ebe3e959dcd7a/`, the `~/.local/bin`
    `sharkctl` and `sharkd` links were moved to it, and `sharkd service install` was run again
    without ambient `HARK_*` overrides. On shuvdev, `/usr/local/bin/sharkd` links to
    `~/.local/bin/sharkd`, so it follows the new bundle without a root change.
  - After the change, both hosts run `sharkctl` 1.0.0 and `sharkd` 1.0.0. `sharkd service status`
    reported installed, loaded, running, and healthy, with no last error class and no counts, and it
    still did about a minute later with the same PID. The launchd job and the systemd unit
    reference only the new bundle, and shuvdev's unit is `active` with 0 restarts.
  - `sharkctl auth status` reported authenticated, and `sharkctl interaction list` succeeded with
    no interactions, on both hosts. No notification or Live Activity was sent.
  - The skill at `~/.agents/skills/shark` was replaced with `skills/shark` from the merge commit on
    both hosts. Its frontmatter shows `metadata.version: "1.0.0"`, and `SKILL.md` hashes to
    `ce2671a15993c2604e6910240564318612acca63af9a4a746b0a8a64edd4e9da` on both. The previous copy
    (`a5026a8588f6ecabbbb3b2c7b253eef1a5869ee75b77ebd73d6bf1c1f8e07012`) was moved to
    `~/.agents/skills/shark.bak-20261010`. `~/.claude/skills/shark` still links to
    `../../.agents/skills/shark`.
- 2026-10-10: production was promoted from `6dcb736` to
  `de5f9fe6da7a84d41da00d8dc30eb917bd822acd` (on-call override creator and recipient notice #126,
  atomic Live Activity and webhook-response admission #129, Web Push service allowlist with pinned
  delivery and prelogin `client_id` binding #127) at image digest
  `sha256:dc5c4188c05589138665c1b56f38aa6f00fa9de05102a688009987e9839dbb02` from publisher run
  `38031269236`. Before the deploy, the orphaned `op daemon` left by the killed `6dcb736` attempt
  was stopped. It held no deploy lock, and no deploy, backup, or Restic process was running.
  `shark-deploy` ran detached from the SSH session. It verified the pre-deploy encrypted Restic
  snapshot `59eda0076967033dd05e10d9a959a77ba0f0c49573cfccb05e04091ab52b4a57` in
  `repos/shark-prod`. That snapshot holds the schema-0026 database a `6dcb736` rollback needs.
  A loopback health probe failed from 06:35:46 to 06:37:06 UTC, while the helper stopped the old
  container, backed it up, and started the new one, and returned 200 from 06:37:07, so production
  was down for about 81 seconds. The running image ID and the provenance record match the digest.
  Startup applied migration 0027 (`1791610113104`), for 28 recorded migrations.
  `oncall_override` gained `created_by_user_id`, which references `user(id)` with
  `ON DELETE SET NULL`. Integrity is `ok` with no foreign-key violations. The deploy changed no
  helpers or Compose definition. All four installed helpers and `/etc/shark/compose.yaml`
  hash-match `main`. The container has `TRUSTED_FORWARDED_FOR_HOPS=1` and no
  `TRUSTED_CLIENT_IP_HEADER`. Post-deploy checks:
  - Health returned 200 with only `{"ok":true}` on the VM and through `https://shark.shuv.dev`. The
    container was healthy with 0 restarts and logged no errors or warnings.
  - Anonymous `/`, `/docs`, `/privacy`, `/terms`, `/dashboard`, `/cli/authorize`,
    `/dashboard/teams/x`, and `/join/x` returned 401. `/robots.txt`, `/sitemap.xml`, and `/pricing`
    returned 404, and `/sw.js` returned 200 JavaScript.
  - An unknown team invite code returned 404. The access log recorded the probes as `/join/:code`
    and `/api/team-invites/:code`.
  - `/mcp` returned 401 with no token and with a forged one, with a challenge that points to the
    protected-resource metadata.
  - The four OAuth discovery documents returned 200 without `watch:*` or `macos:*` scopes.
  - Empty requests to `/api/auth/oauth2/register` and `/api/auth/oauth2/public-client-prelogin`
    returned 400. Each of `/api/auth/oauth2/token`, `/revoke`, and `/introspect` returned 400 for
    an empty form and 415 for JSON. Anonymous `POST /api/web-push/subscriptions` returned 401.
  - The 1Password CLI started a new `op daemon` during this deploy and left it running afterward,
    without the deploy lock. This appears to be normal CLI behavior, not a sign of a killed run.
  - Not yet done for `de5f9fe`: a test notification, signed-in dashboard access, and the macOS
    companion check.
- 2026-10-10: post-deploy operator checks for `de5f9fe`:
  - One labeled test notification, "Post-deploy check de5f9fe" with title "SHark deploy check",
    was sent at 06:45:16 UTC through the existing `sharkctl` login and returned exit 0. It was
    accepted for 4 targets. SHark records only the total, but the active-target counts make that
    2 iOS, 1 macOS, and 1 web. The second web subscription seen at `20e14e1` was already inactive
    before this send.
  - The owner confirmed on iPhone that the notification arrived and shows status Accepted
    (Accepted 4), with a Created, Accepted, and Processing timeline.
  - Since the deploy, the container logged no errors, warnings, or rejected receipts, and no Web
    Push blocked-destination, resolve-failure, or timeout messages. It stayed healthy with 0
    restarts.
  - Web Push subscriptions were 1 active of 2 total both before and after the send, so nothing was
    pruned. iOS (2 active), macOS (1 active), and on-call overrides (0) were unchanged.
  - The existing signed-in dashboard session carried over the deploy. No fresh Apple passkey
    sign-in was performed for this deploy. A fresh reload made 14 successful requests with 0 page
    errors. All 9 of its API requests (inbox, devices, events, activities, services, teams, OAuth
    clients, API tokens, and session) returned 200. The test notification appeared in the inbox,
    and the "This browser" notifications section showed its normal "Enable notifications" state.
    The owner has no teams, so the on-call page and the "· added by" label could not be exercised.
  - The installed macOS companion (`dev.shuv.shark.macos`) has a stored keychain credential and 1
    active registered device, and the app was running. The owner reported that it works.

- 2026-10-10: production was promoted from `20e14e1` to
  `6dcb7367936a8d43b5772baf5b667767fb180c8e` (auth and MCP OAuth follow-ups #111, MCP OAuth
  end-to-end test #112, teams follow-ups #110, callback SSRF pinning #117, on-call overrides and
  atomic rate windows #114) at image digest
  `sha256:d56a3c61033d3814e3f7a3cb303079b435ad0eff68b13a02c546abbc53307d82` from publisher run
  `38027629316`. A first `shark-deploy` attempt was killed when its operator session ended. It had
  already stopped the `20e14e1` container, and because it was killed by a signal, its rollback trap
  never ran. The new image never started, so the database stayed at schema 0025. Before it was
  killed, it had written pre-deploy snapshot
  `1a667909835d0c4c96107627aaee5dea6c8f26782084fbc011fd6998c15e92d8`, which also holds schema 0025
  but is not the recorded backup. Production was down from about 05:31 to 05:35 UTC. A re-run of `shark-deploy`, detached from the SSH session,
  verified the pre-deploy encrypted Restic snapshot
  `0bbc347db385ff9a5749a99995fd54350868070a1f38fbfe0f224c8fd151c50c` in `repos/shark-prod`. That
  snapshot holds the schema-0025 database a `20e14e1` rollback needs. The running image ID and the
  provenance record match the digest. Startup applied migration 0026 (`1791602325119`), for 27
  recorded migrations. The new `agent_notification_retry` table and its 3 indexes exist, and
  `agent_notification` gained `claim_id` and `claimed_at`. Integrity is `ok` with no foreign-key
  violations. The deploy changed no helpers or Compose definition. All four installed helpers and
  `/etc/shark/compose.yaml` hash-match `main`. The container has `TRUSTED_FORWARDED_FOR_HOPS=1` and
  no `TRUSTED_CLIENT_IP_HEADER`. Post-deploy checks:
  - Health returned 200 with only `{"ok":true}`. The container was healthy with 0 restarts and
    logged no errors.
  - Anonymous `/`, `/docs`, `/privacy`, `/terms`, `/dashboard`, `/cli/authorize`,
    `/dashboard/teams/x`, and `/join/x` returned 401. `/robots.txt`, `/sitemap.xml`, and `/pricing`
    returned 404, and `/sw.js` returned 200 JavaScript.
  - An unknown team invite code returned 404. The access log recorded the probes as `/join/:code`
    and `/api/team-invites/:code`.
  - `/mcp` returned 401 with no token and with a forged one, with a challenge that points to the
    protected-resource metadata.
  - The four OAuth discovery documents returned 200 without `watch:*` or `macos:*` scopes.
  - Empty requests to `/api/auth/oauth2/register` and `/api/auth/oauth2/public-client-prelogin`
    returned 400. Each of `/api/auth/oauth2/token`, `/revoke`, and `/introspect` returned 400 for
    an empty form and 415 for JSON.
  - Not yet done for `6dcb736`: a test notification, signed-in dashboard access, and the macOS
    companion check.

- 2026-10-09: production was promoted from `e405b22` to
  `20e14e1a49c8cb8187e92c56c26dc7f8c6473208` (upstream teams/on-call #96, MCP server with OAuth
  #97, board skill guidance #95) at image digest
  `sha256:7797ebeeefed8d6b5fa059d52a9413b2d41295a80532080136e46b97f59ea27b`. `shark-deploy`
  verified the pre-deploy encrypted Restic snapshot
  `392a9e96313b45f8ad14c681dba4d44a1c952d69e4c596e89b2a51a0cac1a296` in `repos/shark-prod`, which
  holds the schema-0023 database an `e405b22` rollback needs. The running image ID and the provenance
  record match the digest. Startup applied migrations 0024 (`1791571932408`) and 0025
  (`1791573278955`), for 26 recorded migrations. The 11 new team, on-call, and OAuth tables exist.
  The rebuilt `agent_notification` table kept its row count and inbox triggers, with integrity `ok`
  and no foreign-key violations. After `deploy/test-helpers` passed, `/etc/shark/compose.yaml` and
  `/usr/local/sbin/shark-materialize-secrets` were reinstalled. Their only changes were the fixed
  `APNS_MACOS_BUNDLE_ID` and `TRUSTED_FORWARDED_FOR_HOPS=1`. Both kept their owners and modes and
  hash-match `main`. The container has `TRUSTED_FORWARDED_FOR_HOPS=1` and no
  `TRUSTED_CLIENT_IP_HEADER`. Post-deploy checks:
  - Health returned 200 with only `{"ok":true}`. The container was healthy with 0 restarts.
  - Anonymous `/`, `/docs`, `/privacy`, `/terms`, `/dashboard`, `/cli/authorize`,
    `/dashboard/teams/x`, and `/join/x` returned 401. `/robots.txt`, `/sitemap.xml`, and `/pricing`
    returned 404, and `/sw.js` returned 200 JavaScript.
  - The access log recorded the invite probe as `/join/:code`.
  - `/mcp` returned 401 with no token and with a forged one, with a challenge that points to the
    protected-resource metadata.
  - The four OAuth discovery documents returned 200 without `watch:*` or `macos:*` scopes.
  - The hourly OAuth sweeper logged no failure.
  - A capture on the VM showed two `X-Forwarded-For` entries, both the real client IP, after any
    forged value, so the rightmost-entry rate-limit key is the real client.
- 2026-10-09: post-deploy operator checks for `20e14e1`:
  - The local checkout fast-forwarded cleanly to `20e14e1`.
  - Empty requests to the anonymous OAuth endpoints returned validation errors, not content. Each of
    `/api/auth/oauth2/register` and `/api/auth/oauth2/public-client-prelogin` returned 400. Each
    of `/api/auth/oauth2/token`, `/revoke`, and `/introspect` returned 400 for an empty form and
    415 for JSON.
  - One labeled test notification sent through the existing `sharkctl` login returned exit 0. It was
    accepted for 5 targets: 2 iOS, 1 macOS, and 2 web. Afterward, the container logged no push
    errors or rejected receipts and still had 0 restarts.
  - The installed macOS companion (`dev.shuv.shark.macos`) has a stored credential and an active
    registered device. The operator confirmed that its menu-bar inbox loads on `20e14e1`.
  - Apple web sign-in with a passkey succeeded. The signed-in dashboard loaded with 0 console or
    page errors, and all 9 of its API requests, including `/api/teams`, `/api/oauth/clients`, and
    `/api/api-tokens`, returned 200. The Teams section showed its empty state. Inbox, devices,
    activity, and the board (`/board`, 5 recently done items) kept their existing data. Bare
    `/dashboard/teams` returns 404 because teams render on `/dashboard` and only
    `/dashboard/teams/:teamId` is routed.
  - `sharkctl` re-authenticated through the browser device flow with the 14 default scopes plus
    `teams:read`, `teams:write`, `oncall:read`, `oncall:write`, `board:read`, and `board:write`.
    The new login holds exactly those 20 scopes.
  - An end-to-end MCP OAuth client registered dynamically against `/mcp` and requested only
    `inbox:read board:read`. The consent page offered only those two scopes. After approval, the
    token exchange granted exactly those scopes, with no refresh token. The client listed 75 tools
    (30 marked read-only) and called `inbox_projects` without error. After Disconnect in the
    dashboard, the client no longer appeared, `/mcp` returned 401 for the old access token, and
    a refresh attempt returned 400.
  - The `.pre-20e14e1` backups of `/etc/shark/compose.yaml` and
    `/usr/local/sbin/shark-materialize-secrets` were deleted from the VM. The live copies still
    hash-match `main` with unchanged owners and modes. The older `.pre-d304727` copies remain.

- 2026-08-20: native macOS menu-bar companion, scoped device-code authorization, encrypted APNs
  device registration, privacy-redacted delivery, inbox/actions, and mixed-platform fanout were
  added. Contracts (28), sharkctl (31), Expo (31), website (224), and macOS (3) tests passed;
  monorepo lint, typecheck, production build, brand checks, migration regeneration, and diff checks
  passed. A signed Debug app for `dev.shuv.shark.macos` validated on disk with the development APS,
  sandbox, and outbound-network entitlements. Production deployment, local installation, account
  linking, notification authorization, and a real APNs receipt remain separate acceptance gates.
- 2026-07-27: root typecheck passed.
- 2026-07-27: contracts 24 tests, CLI 29 tests, Expo 15 tests, and website 179 tests passed
  (247 total).
- 2026-07-27: lint and production web/server build passed.
- 2026-07-27: `expo install --check` reported dependencies up to date.
- 2026-07-27: pinned `expo-doctor@1.20.1` passed all 20 checks.
- 2026-07-27: Expo public config resolved SHark name, scheme, app/widget/notification extension
  bundle IDs, and App Group without an upstream EAS project or Team ID.
- 2026-07-27: a disposable migrated SQLite database produced a verified exact-schema checkpoint
  copy through the bundled production backup command.
- 2026-07-27: workflow YAML, deployment wrapper shell syntax, and operator bundles validated.
- 2026-07-27: the recovered Devil Phone SVG and safe-area raster matched both historical SHA-256
  values; operator-controlled Git history, repository license, asset notice, and prior ownership
  confirmation established positive provenance.
- 2026-07-27: pinned Resvg generation produced byte-identical second-pass assets; the 1024px app
  icon is opaque 8-bit RGB and all generated hashes are recorded in
  `assets/brand/generated-assets.json`.
- 2026-07-27: PNG compression moved from platform-native Node zlib to pinned pure-JavaScript
  `fflate` 0.8.3. Regeneration changed only compressed bytes: the decoded scanline SHA-256 values
  for the app icon, favicon, App Store icon, and Open Graph image were identical before and after.
- 2026-07-27: clean native prebuild resolved only SHark external identifiers under proven operator
  Team `7H54B326YZ`; generated source entitlements contain the expected App Group, development APNs,
  Sign in with Apple, Siri, communication notification, and Live Activity configuration.
- 2026-07-27: a live built-server probe returned 200 only for `/api/health`, 401 for private
  document/static paths, and 404 for removed pricing/discovery paths. HTML document requests now
  redirect without a response body to the fixed Apple sign-in bootstrap.
- 2026-07-27: Apple App IDs exist for `dev.shuv.shark`, `dev.shuv.shark.widgets`, and
  `dev.shuv.shark.notification-service`; main push/Siri/App Group/Apple-auth capabilities and
  widget App Group capability are configured. Apple added its immutable default in-app-purchase
  capability, but SHark creates no products or billing surface.
- 2026-07-27: isolated exe.dev VM `shark-prod` exists in PDX with 2 vCPU, 4 GB RAM, and 25 GB disk.
  No application or secrets are deployed yet.
- 2026-07-27: the secret-free worktree built successfully as a Linux Docker image on `shark-prod`;
  an ephemeral loopback smoke container returned health 200, API-style root 401, browser-style root
  302, authenticated favicon 401, and removed pricing 404, then was deleted.
- 2026-07-27: application-secret and off-host-backup helpers passed success and fail-closed fixture
  tests on macOS and on the production Linux VM. A failed Bitwarden read preserved the last good
  runtime environment; failed Restic verification preserved the staging copy; and an out-of-bound
  input was rejected. The success path required an exact byte comparison against a copy streamed
  back from the newly created encrypted snapshot before deleting plaintext.
- 2026-07-27: checksum-verified official `bws` 2.1.0 and Restic 0.19.1 binaries were installed
  root-owned on `shark-prod`.
- 2026-07-27: the four production/operator wrappers and inactive backup systemd units from reviewed
  commit `220ad59b0fde4cc57f421cc23f6ceca668370389` were installed root-owned on `shark-prod`.
  `/etc/shark` exists with the documented boundary; no credentials were installed and the backup
  timer remains disabled.
- 2026-07-27: after exe.dev proved the forced-command boundary impossible, the reviewed plan and
  helpers were revised to publish an attested public GHCR digest, require operator promotion, and
  use separate Bitwarden application/backup machine accounts. The new local helper fixtures pass
  and a failed Bitwarden read preserves the last good runtime environment. The older wrappers
  installed on `shark-prod` are inactive and superseded, not production-ready evidence.
- 2026-07-28: Bitwarden project `shark` is visible to the provisioning identity as UUID
  `cda1aac8-67e1-498a-9d5c-b49401517ca8`; a value-redacted query found zero project secrets. The
  exact UUID plus newline was installed on `shark-prod` as `/etc/shark/bws-project-id`, owned by
  `root:exedev`, mode `0440`, with SHA-256
  `f39b5c9394f503c719a0962837282f6fb1324e7857e271a1a7eae672b580cda0`.
- 2026-07-28: the four operator/backup helpers and Compose definition from CI-green commit
  `79af51016820afecf6599d205e137de983ecd71e` were installed root-owned on `shark-prod` and
  hash-matched the committed files. The backup timer remains disabled and inactive; no runtime
  token, secret, image, or production service was installed or started.
- 2026-07-28: separate app and backup Bitwarden machine access tokens were installed on
  `shark-prod` as root-owned, `root:exedev`, mode `0440` bootstrap files. Value-redacted live
  queries authenticated both tokens and showed that each can list exactly the `shark` project and
  no unrelated project. The project still contains zero secrets, no runtime environment was
  materialized, and the backup timer remains disabled and inactive.
- 2026-07-28: real production values were created in Bitwarden for `APPLE_TEAM_ID`,
  `BETTER_AUTH_SECRET`, `RESTIC_REPOSITORY`, and `RESTIC_PASSWORD`; no value was printed or written
  to Git. A dedicated passwordless ED25519 key for `shark-prod` was authorized on the existing
  rsync.net account, all three observed rsync.net host-key fingerprints matched the operator Mac's
  previously trusted entries, and the key authenticated with `IdentitiesOnly` and strict host-key
  checking. The dedicated `repos/shark-prod` Restic repository was initialized and `restic check`
  passed.
- 2026-07-28: both runtime machine accounts still have whole-project read access and therefore
  return all four current keys. The application materializer rejected that mixed key set with exit
  78 and preserved the absent runtime environment. Direct disjoint grants remain mandatory before
  deployment.
- 2026-07-28: the Bitwarden Free organization limit prevented the required pair of isolated SHark
  runtime identities, so the reviewed design migrated to 1Password. Separate
  `SHark Production App` and `SHark Production Backup` vaults contain exactly one Secure Note each
  with the expected eight-field and two-field schemas. Two non-expiring read-only service accounts
  were created with access only to their corresponding vault. Operator recovery copies of both
  one-time tokens are stored in the Personal vault, which neither runtime account can access.
- 2026-07-28: official 1Password CLI 2.35.0 was installed on `shark-prod`. The application and
  backup service-account tokens were installed as `/etc/shark/op-app-service-account-token` and
  `/etc/shark/op-backup-service-account-token`, owned by `root:exedev` with mode `0440`. Live
  value-redacted checks proved each token lists exactly its one expected vault and one item. The
  application helper materialized exactly its 12-key environment at mode `0600`; the disposable
  environment and all verification JSON were then removed. The backup identity returned exactly
  `RESTIC_PASSWORD` and `RESTIC_REPOSITORY`. Local migration copies of both tokens and the temporary
  Bitwarden binary were removed.
- 2026-07-28: after explicit destructive-action confirmation, the legacy Bitwarden `shark`
  machine account was permanently deleted, revoking both access tokens; the `shark` project and
  its ten migrated secrets were permanently deleted; and the three `/etc/shark/bws-*` bootstrap
  files were removed from `shark-prod`. A live Bitwarden API query returned zero secrets for the
  deleted project UUID, the organization retained only its two unrelated projects and machine
  accounts, and 1Password-backed application materialization still passed afterward.
- 2026-07-28: Cloudflare serves DNS-only CNAME `shark.shuv.dev` to `shark-prod.exe.xyz`; exe.dev
  publicly proxies the custom domain to port 8787. Independent HTTPS probes returned 200 with
  successful TLS verification for `/api/health`, 401 for the six protected application routes,
  and 404 for removed `/robots.txt` and `/sitemap.xml` surfaces.
- 2026-07-28: protected production publisher run `30406075373` verified merge
  `f56d7cd24b3f480c9e74f2226bfadcfed2c61d00`, published immutable image digest
  `sha256:f168e1cc93d6b8ea030bd07d590e51063479c7a06352d02daaf77b0964730a98`, and attached
  GitHub provenance. The VM verified that public OCI attestation without a GitHub credential,
  pulled the exact digest, and promoted it successfully.
- 2026-07-28: the production promotion created encrypted Restic snapshot
  `209a66a44bc390dece5238b239be3317fd15c2cf2af208d14b5707f29c1e8bf3`, confirmed it in the
  off-host repository, restored the staged database byte-for-byte, checked and pruned the
  repository, and recorded the snapshot in `/home/exedev/shark/current`. The recorded Git SHA,
  image digest, and running container image ID all match; the deployment lock is available and no
  1Password daemon holds it.
- 2026-07-28: production deployment helpers now close the deploy-lock descriptor before invoking
  1Password, force Restic through its supported `sftp.args` option with the provisioned SSH config
  and pinned rsync.net host keys, and atomically finalize the current provenance record. Regression
  fixtures cover all three failure modes.
- 2026-07-27: GitHub environment `shark-production` exists and accepts deployments only from
  `main`; it contains no production credentials.
- 2026-07-27: `main` branch protection requires the strict, up-to-date GitHub Actions
  `Verify source` check, includes administrators, requires linear history and resolved
  conversations, and disables force-pushes and deletion.
- 2026-07-27: the deleted upstream `Production Deployment` workflow remained dispatchable in
  GitHub after its source file was removed, so it was explicitly disabled. `SHark CI` and
  `Production Update` remain active.
- 2026-07-27: the reviewed `shark` skill was installed from exact commit
  `fff807327b4d3af5c7e7f9abcb06584bd2513523` and hash-matches the repository source. `harkctl`
  0.3.0 was packed from that commit, installed from the retained artifact with SHA-256
  `3d36c5871cb5375fdcde804642e0b2da426d28b7250038dbe4959106fc1c5e7e`, and passed all 29 CLI
  tests.
- 2026-07-30: the canonical fork CLI was renamed and packed as `sharkctl` 0.4.0. The reviewed
  artifact was installed globally with SHA-256
  `bb317e065ab4d93c5bf2d587fc597d4f214994fe3800578db28d07690a563be1` and passed all 31 CLI
  tests. The globally installed `shark` skill hash-matches the 1.3.0-shark.1 repository source at
  SHA-256 `ecd611c0f380bc151573933618b44709421f53a65b4be3e026cbfb7227217781`.
- 2026-07-27: a tracked-history scan found no private-key blocks or common GitHub, Stripe, or Expo
  token forms. No `.p8`, `.p12`, provisioning profile, `.env`, or production environment file
  exists in the worktree; parser strings and runtime variable names were classified as code, not
  credential values.

## Blocked release evidence

- Physical light, dark, tinted, splash, and mask appearance review: pending a development build.
- Expo project ownership: the EAS CLI is waiting for the operator to complete its one-time browser
  sign-in; the managed browser cannot reach `expo.dev`.
- Apple App Group/Services ID associations and the App Store Connect record: the managed browser
  cannot reach the Apple developer portal, so the operator must complete the recorded manual
  portal steps.
- 2026-07-27: exact-head Ubuntu CI run `30303069003` passed source verification, all 247 tests,
  deterministic brand generation, helper fixtures, and the production Docker image build for
  commit `74b4b21ae39dfa1a9d6ba1948465340458ff468c`.
- Sqim development artifact, HTTPS install page, signed entitlements, and two-iPhone acceptance:
  pending operator-owned identities and assets.
- `shark-prod` no-op deployment and rollback rehearsal: not yet proven. DNS/TLS, immutable running
  image, verified off-host snapshot, and byte-for-byte restore are proven above.
- EAS/App Store Connect build, internal TestFlight installation, release tag, and final provenance:
  not yet proven.
