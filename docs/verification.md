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
- 2026-07-27: GitHub environment `shark-production` exists and accepts deployments only from
  `main`; it contains no production credentials.

## Blocked release evidence

- Physical light, dark, tinted, splash, and mask appearance review: pending a development build.
- Expo project ownership: the EAS CLI is waiting for the operator to complete its one-time browser
  sign-in; the managed browser cannot reach `expo.dev`.
- Apple App Group/Services ID associations and the App Store Connect record: the managed browser
  cannot reach the Apple developer portal, so the operator must complete the recorded manual
  portal steps.
- Production DNS: the active Cloudflare token is read-only and the managed browser cannot reach
  the Cloudflare dashboard. `shark.shuv.dev` still does not resolve.
- Bitwarden production projects and scoped machine accounts: the authenticated organization is at
  its three-project plan limit. No unrelated project was reused or removed.
- Restricted deployment transport: exe.dev terminates SSH at its account gateway and does not
  expose a per-key VM `authorized_keys` boundary. A VM-tagged key would retain shell access, so no
  GitHub deployment key was created while the operator chooses a safer replacement.
- Sqim development artifact, HTTPS install page, signed entitlements, and two-iPhone acceptance:
  pending operator-owned identities and assets.
- `shark-prod` DNS/TLS, immutable running image, verified off-host snapshot, restore, no-op deploy,
  and rollback: not yet proven.
- EAS/App Store Connect build, internal TestFlight installation, release tag, and final provenance:
  not yet proven.
