# SHark v1 verification ledger

This ledger records evidence without secrets, user content, private identifiers, or unredacted
logs. Unchecked release evidence keeps the goal active.

## Source baseline

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
- Production DNS: the active Cloudflare token is read-only and the managed browser cannot reach
  the Cloudflare dashboard. `shark.shuv.dev` still does not resolve.
- Bitwarden runtime identities and secrets: project `shark`
  (`cda1aac8-67e1-498a-9d5c-b49401517ca8`) now exists and is visible to the authenticated
  provisioning machine account. Separate app and backup runtime tokens are installed and each is
  limited to listing this project. Four of ten values now exist: `APPLE_TEAM_ID`,
  `BETTER_AUTH_SECRET`, `RESTIC_REPOSITORY`, and `RESTIC_PASSWORD`. Populate `ALLOWED_EMAILS`,
  `APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_PRIVATE_KEY_BASE64`, `EXPO_ACCESS_TOKEN`, `APNS_KEY_ID`,
  and `APNS_PRIVATE_KEY_BASE64`; remove whole-project access from both runtime accounts; and grant
  each account direct access only to its eight application or two backup secrets before either
  helper can pass its fail-closed key-set check.
- GHCR publication/promotion: pending merge to `main`, a green manual publisher run, explicit
  public package visibility, anonymous pull/attestation verification on `shark-prod`, and
  installation of the revised helpers and Compose definition. No GitHub deployment key exists.
- 2026-07-27: exact-head Ubuntu CI run `30303069003` passed source verification, all 247 tests,
  deterministic brand generation, helper fixtures, and the production Docker image build for
  commit `74b4b21ae39dfa1a9d6ba1948465340458ff468c`.
- Sqim development artifact, HTTPS install page, signed entitlements, and two-iPhone acceptance:
  pending operator-owned identities and assets.
- `shark-prod` DNS/TLS, immutable running image, verified off-host snapshot, restore, no-op deploy,
  and rollback: not yet proven.
- EAS/App Store Connect build, internal TestFlight installation, release tag, and final provenance:
  not yet proven.
