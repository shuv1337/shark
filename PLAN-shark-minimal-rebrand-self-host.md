# SHark Minimal Rebrand and Self-Hosting Plan

## Objective

Fork the current Hark codebase into a personally operated, noncommercial SHark
deployment with:

- SHark as the user-facing product name.
- The canonical red Devil Phone artwork, after its current source and ownership
  record are located and verified on this Mac.
- A new iOS app, Apple identifiers, Expo project, Apple OAuth client, and push
  credentials owned by the SHark operator.
- A single-host Docker Compose deployment behind HTTPS.
- All Hark capabilities enabled for the self-hosted operator without depending
  on Autumn billing.
- Production access restricted to an explicit account allowlist.
- The smallest practical patch surface so upstream Hark changes remain easy to
  merge.

The reviewed upstream code baseline is
`0c0d4e3de0752ee91d2a17dee83a313f6863d6a8`. The current SHark repository HEAD
is `e72dbd6a5ff81adb3964bb6390c6a181d2eeea5c`; the only changes since the
upstream baseline are this plan and its handoff.

## Executive Recommendation

Use `https://shark.shuv.dev` as the working production origin and
`dev.shuv.shark` as the working iOS bundle identifier. Start with private
internal-TestFlight distribution and prove every push and Live Activity path on
two physical iPhones. Public TestFlight and App Store distribution are excluded
from v1 and require a separate future scope decision.

Keep these internal compatibility names unchanged:

- Workspace package names such as `@hark/contracts`.
- Database filename and Docker volume names containing `hark`.
- Token prefixes, token domain-separation strings, route paths, DTO names, CSS
  class names, and Swift/TypeScript symbols containing `Hark`.
- The existing `harkctl` executable and `HARK_*` environment/config namespace.

Change product-facing copy, public origins, store metadata, icons, native
identifiers, OAuth credentials, deployment ownership, and documentation. This
produces a real SHark experience without a high-conflict mechanical namespace
rename. A later optional phase can add a `sharkctl` alias, but it should not
block the initial self-host.

The two intentional functional additions are:

1. An explicit self-hosted entitlement mode so the deployment does not lose
   interactions, device routing, or Live Activities when Autumn is absent.
2. A fail-closed email allowlist so exposing the Apple OAuth endpoints does not
   create a public signup service.

## Verified Current State

### Repository and upstream

- This plan and its handoff are tracked; the current working tree contains only
  their requested follow-up revisions.
- `origin` is `git@github.com:shuv1337/shark.git`.
- `upstream` is `git@github.com:R44VC0RP/hark.git`.
- `origin/main` and local `main` point to `e72dbd6`; `upstream/main` remains at
  the reviewed code baseline `0c0d4e3`.
- The fork is public and inherits PolyForm Noncommercial 1.0.0.
- The repository contains 183 tracked files across a React/Hono website,
  Expo iOS app, shared contracts, CLI, and agent skill.

### Architecture

- `apps/website`: one Hono process serving the API and built React SPA.
- `apps/website/src/server/db`: SQLite/Drizzle schema and startup migrations.
- `apps/expo`: iOS-only Expo app with a notification service extension and
  Live Activity widgets.
- `packages/contracts`: API and Live Activity contracts shared by web and app.
- `packages/harkctl`: Node 22 CLI with a configurable `HARK_API_URL`.
- `packages/website-runtime`: the production-only dependency bundle used by the
  Docker image and WAL-aware backup tooling.
- `skills/hark`: installable agent skill.
- `Dockerfile` and `compose.yaml`: first-party single-container deployment with
  persistent SQLite storage under `/data`.

### Baseline verification

The following commands passed before planning:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Results:

- Typecheck passed in all participating workspaces.
- 227 tests passed: 29 CLI, 24 contracts, 15 Expo, and 159 website.
- Biome checked 120 files with no findings.
- The production client, prerendered pages, and bundled Hono server built
  successfully.

### Important constraints found in code

- `apps/website/src/server/lib/billing.ts` returns the Free plan when
  `AUTUMN_API_KEY` is absent.
- Free-plan checks in `hooks.ts`, `interactions.ts`, `activities.ts`, and
  `activity-hooks.ts` disable device routing, interactive replies, and/or Live
  Activities. An empty Autumn key is therefore not a complete self-host mode.
- `apps/website/src/server/auth.ts` currently allows any valid Google or Apple
  account to create a user; SHark will remove Google and admit only allowlisted
  Apple identities.
- An email allowlist applied only when a user or session is created would not
  revoke existing browser sessions, API tokens, webhook URLs, interaction
  credentials, or Live Activity credentials.
- Sign in with Apple may return a real or private relay address. SHark admits
  the exact verified Apple email returned for the account, normalized only for
  comparison, and accepts either form when that literal address is allowlisted.
- The app still contains the upstream Apple Team ID, EAS project ID, bundle
  identifiers, App Store Connect ID, production domain, and TestFlight link.
  None may be reused for SHark.
- Normal notifications are sent through the Expo Push Service. Live Activity
  start/update/end traffic goes directly to APNs. Both credential paths must be
  configured.
- The iOS app requires a physical-device test for complete push behavior.
- The production server runs SQLite in WAL mode. A safe backup must checkpoint
  the WAL before copying the main database, then run `integrity_check`.

## Scope Boundary

### In scope

- User-facing SHark name and Devil Phone imagery.
- Website, metadata, documentation, iOS display name, splash/app icon, and
  native notification service name.
- New domain, Apple/Expo identities, signing, push, and TestFlight.
- Explicit self-host entitlements and account allowlisting.
- Docker Compose deployment, proxy/TLS, secrets, backup, restore, deployment,
  manual operational checks, and rollback.
- Locally consumable CLI and SHark agent-skill documentation.
- Automated and physical-device acceptance testing.

### Explicitly out of scope for the minimal fork

- Renaming every `@hark/*` package or TypeScript/Swift symbol.
- Changing API route shapes, DTO schemas, database table names, or token
  prefixes.
- Publishing a renamed CLI to npm.
- Charging users, configuring Autumn, or operating a commercial service.
- Replacing SQLite with Postgres or adding horizontal scaling.
- Redesigning the UI beyond product copy, brand marks, icons, and necessary
  legal/self-host states.
- Recutting the existing product demo video in the first milestone. Hide it or
  mark it as upstream material until a genuine SHark capture exists.

## Frozen Decision Record

The user confirmed this decision record after grilling. These values are frozen
for v1 and must be changed consistently before any affected external resource
is created:

| Decision | Frozen value | Why |
| --- | --- | --- |
| Production origin | `https://shark.shuv.dev` | Short, branded, and under an existing operator domain |
| iOS bundle ID | `dev.shuv.shark` | Stable reverse-DNS identifier owned by the operator |
| Widget bundle ID | `dev.shuv.shark.widgets` | Must be unique and derived from the app ID |
| Notification-service bundle ID | `dev.shuv.shark.notification-service` | Freezes the extension identity instead of deriving it from a rebranded target name |
| App Group | `group.dev.shuv.shark` | Keeps app/widget sharing under the same namespace |
| URL scheme | `shark` | Makes native auth and development deep links branded |
| Distribution | Internal TestFlight only | Frozen first-release distribution boundary |
| Authentication | Apple only | Frozen first-release provider boundary |
| Account admission | Exact email allowlist, enforced at every credential-bearing entry point | Prevents both new signup and continued use after removal |
| Apple identity policy | Accept the exact verified Apple email, including relay addresses | Honors the identity Apple returns without cross-provider linking |
| Self-host rate limits | 300/service/min and 1,500/account/min | Reuses current Pro defaults and minimizes code/test churn |
| Paid tiers | Disabled; self-host gets full capability | Removes Autumn without breaking core features |
| UI palette | Preserve existing Hark UI colors | Limits scope; Devil Phone becomes the identifying mark |
| CLI name | Keep `harkctl` initially | Avoids package/config/token churn while still supporting SHark |

If a different domain or bundle ID is selected, substitute it everywhere in
Phases 1–5 before creating any external identifiers. App and extension bundle
IDs cannot be casually renamed after distribution begins.

## Phase 0 — Legal and Ownership Gate

- [ ] Confirm the deployment is personal/noncommercial or obtain a separate
  commercial license from the upstream licensor before any anticipated
  commercial use.
- [ ] Preserve the root `LICENSE`, `packages/harkctl/LICENSE`, and the license
  declaration in `skills/hark/SKILL.md`.
- [ ] Keep upstream copyright/attribution and add a short fork notice to
  `README.md`: “SHark is a minimally rebranded, self-hosted fork of Hark.”
- [ ] Record the upstream repository URL and pinned baseline commit in the
  README.
- [ ] Record a positive ownership and provenance statement for the Devil Phone
  artwork. The prior Linux paths under `/home/shuv/repos/codex-quota/web/icons`
  do not exist in the current Mac checkout. Locate the authoritative source,
  re-verify its hash, and record an affirmative license/ownership basis before
  copying it. Do not treat an unrelated third-party notice as a license grant.
- [ ] Replace the upstream operator-specific privacy policy and terms in
  `apps/website/src/client/pages/Legal.tsx` with accurate SHark operator,
  hosting, retention, subprocessors, contact, and account-deletion language.
- [ ] Do not retain claims about paid plans or the original operator's service.

Validation:

- [ ] `rg -n "Ryan Vogel|R44VC0RP|hark\\.ryan\\.ceo|Hark Pro|\\$8|mandarin3d|Stripe|Autumn"`
  returns only deliberate attribution, historical, test-fixture, or
  compatibility references.
- [ ] Do not publish privacy or support pages anonymously in v1. If Apple makes
  an anonymous URL mandatory for the internal-TestFlight artifact, stop and
  return for a scope decision.

## Phase 1 — Introduce the Minimal SHark Brand Layer

### 1.1 Canonical brand and origins

- [ ] Add a small website brand module, for example
  `apps/website/src/shared/brand.ts`, containing the user-facing product name,
  service origin, source repository URL, operator name, and support reference.
- [ ] Remove public SEO structured data, public docs prerendering, sitemap
  publication, and public Open Graph assumptions. Retain only metadata useful
  after an allowlisted user authenticates.
- [ ] Keep one fixed production origin for this personal deployment rather than
  building a general white-label system.
- [ ] Remove or auth-gate `robots.txt`, `sitemap.xml`, and static brand/media
  assets so `/api/health` is the only anonymous content response.
- [ ] Change `/oss` in `apps/website/src/server/app.ts` to the SHark fork URL.

### 1.2 Product-facing copy

- [ ] Replace visible “Hark” with “SHark” in:
  - `apps/website/index.html`
  - `apps/website/src/client/pages/Landing.tsx`
  - `apps/website/src/client/pages/Docs.tsx`
  - `apps/website/src/client/pages/Dashboard.tsx`
  - `apps/website/src/client/pages/CliAuthorize.tsx`
  - `apps/website/src/client/components/AppDownloadBanner.tsx`
  - `apps/website/src/client/pages/Legal.tsx`
  - `apps/expo/app/index.tsx`
  - `apps/expo/app/home.tsx`
  - `apps/expo/targets/notification-service/NotificationService.swift`
  - `apps/expo/targets/notification-service/expo-target.config.js`
  - `README.md`, `packages/harkctl/README.md`, and `skills/hark/SKILL.md`
- [ ] Change the Better Auth display name in
  `apps/website/src/server/auth.ts` to `SHark`.
- [ ] Change user-facing server log names and default notification titles to
  `SHark` without changing stable token/payload namespaces.
- [ ] Delete the pricing page and remove public SEO structured data.
- [ ] Remove the upstream TestFlight URL and original demo/store identifiers
  until SHark replacements exist.
- [ ] Remove `/pricing` and all public marketing/docs navigation. In v1 only
  health-check endpoints are anonymously readable; every human-facing page
  requires Apple authentication.

### 1.3 Preserve compatibility identifiers

- [ ] Do not replace cryptographic domain-separation strings in
  `apps/website/src/server/lib/token.ts`; changing them would invalidate
  existing credentials without adding user value.
- [ ] Do not rename SQLite tables, migrations, event IDs, webhook token
  prefixes, or `hark` CSS classes.
- [ ] Do not rename workspace packages in `package.json`,
  `apps/*/package.json`, or `packages/*/package.json`.
- [ ] Keep `HARK_API_URL`, `HARK_TOKEN`, and `HARK_CONFIG` supported.
- [ ] Document these as protocol/compatibility names, not incomplete branding.

Validation:

- [ ] Add authentication-boundary tests proving `/api/health` is anonymous while
  every human-facing page and static content path requires an allowlisted Apple
  session.
- [ ] Run the exhaustive branding audit:

  ```bash
  rg -n -i --hidden -g '!.git' -g '!pnpm-lock.yaml' \
    'Hark|hark\.ryan\.ceo|ceo\.ryan\.hark|R44VC0RP|PjCnKETB|9G68SMNHEU|0fce08a7|6794121509|raven-cobra|exe\.xyz|exedev|mandarin3d'
  ```

- [ ] Classify every remaining match as compatibility, attribution, a test
  fixture, or a defect.

## Phase 2 — Build the Devil Phone Asset Pipeline

Phase 2 is blocked until the operator recovers the exact historical source
assets from an operator-controlled backup or checkout and confirms their
ownership/provenance. The required inputs are:

```text
/home/shuv/repos/codex-quota/web/icons/devil-phone.svg
historical SHA-256: 3489212420a5c2cbaa56cec28933b1e1284739b11e3388650ea3fb8a4a7e9f69
```

and:

```text
/home/shuv/repos/codex-quota/web/icons/icon-maskable-512.png
historical SHA-256: 5d3fa36bb3865110761752c978b811d0b44755e44a99376acf6c9f453af9af1e
```

- [ ] Recover both canonical files and require the recorded hashes to match
  before use. A mismatch is a hard stop requiring a new provenance decision.
- [ ] Copy the canonical SVG into a tracked SHark source-asset location, such
  as `assets/brand/devil-phone.svg`.
- [ ] Add a deterministic asset-generation script under `scripts/` rather than
  manually exporting multiple derivatives.
- [ ] Add one rasterizer, preferably `@resvg/resvg-js`, as an exact reviewed
  devDependency committed through the lockfile. Record the renderer version,
  color profile, metadata behavior, and command in the provenance document.
- [ ] Generate an opaque 1024×1024 RGB iOS icon using the safe-area composition
  from `icon-maskable-512.png`: charcoal/near-black field, centered red Devil
  Phone, no alpha channel.
- [ ] Deliberately choose either one opaque icon that safely degrades across
  appearances or explicit `ios.icon` light/dark/tinted variants; do not leave
  the tinted Home Screen appearance unreviewed.
- [ ] Generate:
  - `apps/expo/assets/icon.png` at 1024×1024, opaque RGB.
  - `apps/website/public/favicon.png`.
  - `apps/website/public/app-store-icon.png`.
  - A small website header/logo asset.
  - `apps/website/public/ogimage.png` with SHark name, Devil Phone, and a concise
    webhook-to-iPhone message.
- [ ] Update `apps/expo/assets/icon.svg` to be the vector source for the SHark
  app icon or replace its role with the tracked canonical asset.
- [ ] Replace the current dot-only `brandMark` elements in the web and Expo
  headers with the Devil Phone asset, with decorative `alt=""` when adjacent
  to the SHark wordmark.
- [ ] Preserve the existing green layout/theme initially; restrict red to the
  mark and icon so this remains a minimal rebrand.
- [ ] Add attribution/asset provenance documentation and expected hashes.

Validation:

- [ ] Generated files are byte-for-byte stable on a second run with the pinned
  renderer version and documented environment. Re-review and regenerate hashes
  deliberately when that version changes.
- [ ] `file apps/expo/assets/icon.png` reports 1024×1024 RGB with no alpha.
- [ ] The iOS icon has sufficient safe-area padding and no clipped horns,
  handset, tail, or arrow at all mask shapes.
- [ ] Favicon, header, Open Graph image, splash screen, Sqim development build,
  and TestFlight build all display the same canonical mark.
- [ ] Inspect the app icon on a physical iPhone in light, dark, and tinted Home
  Screen contexts.

## Phase 3 — Add Explicit Self-Hosted Product Semantics

### 3.1 Self-host entitlement mode

- [ ] Make `DEPLOYMENT_MODE=self_hosted` the only supported SHark production
  mode. Development and test may use documented local defaults, but SHark does
  not preserve the upstream hosted/commercial product mode.
- [ ] Normalize optional string environment values centrally before validation:
  trim whitespace, convert empty strings to `undefined`, split and deduplicate
  comma-separated emails, and lowercase email comparisons. This is required
  because Compose currently supplies absent optional values as empty strings.
- [ ] Remove Autumn runtime/configuration dependencies, `autumn.config.ts`,
  checkout/portal routes and controls, paid-plan copy, notification metering,
  and tracking calls from the SHark fork.
- [ ] Reject a non-empty legacy `AUTUMN_API_KEY` at startup so stale deployment
  configuration cannot imply that billing is active.
- [ ] Define and test the startup credential matrix:
  - development/test may use documented local defaults,
  - production requires `DEPLOYMENT_MODE=self_hosted`,
  - production requires a non-empty allowlist plus complete Apple, Expo, and
    APNs credential groups,
  - a partially configured credential group is always an error.
- [ ] Refactor `apps/website/src/server/lib/billing.ts` into a compatibility
  entitlement adapter that always returns:
  - `plan: "pro"` for compatibility with existing capability checks.
  - `features.deviceRouting: true`.
  - Unlimited devices.
  - The existing numeric `limits.notificationsPerMonth` compatibility value so
    `BillingDto` does not change, but `usage.notificationsRemaining: null`.
  - Unconditional notification allowance and no notification tracking;
    the numeric compatibility value is never enforced as a monthly meter.
  - Explicit, configurable per-minute abuse limits.
  - `configured: false` so no checkout or portal button appears.
- [ ] Set self-host limits to 300 requests/minute per service and 1,500
  requests/minute per account.
- [ ] Rename user-facing “Pro” errors and labels to capability-oriented wording
  in self-hosted mode where the API contract permits it.
- [ ] Remove checkout, portal, upgrade, and paid-plan controls rather than
  hiding them.

Tests:

- [ ] Add unit tests for the fixed self-hosted entitlement result and for
  rejection of a non-empty legacy `AUTUMN_API_KEY`.
- [ ] Add client tests proving the self-hosted billing state renders as
  unmetered/self-hosted rather than as a numeric paid-plan allowance.
- [ ] Add route tests proving self-hosted accounts can:
  - register multiple devices,
  - target devices,
  - create approval/text interactions,
  - start/update/end Live Activities.
- [ ] Add startup tests for the full credential matrix, empty and
  whitespace-only values, duplicate emails, and case-variant emails.

### 3.2 Fail-closed account admission

- [ ] Add `ALLOWED_EMAILS` to `apps/website/src/server/env.ts` as a
  comma-separated, normalized exact allowlist.
- [ ] Require at least one allowed address when
  `NODE_ENV=production` and `DEPLOYMENT_MODE=self_hosted`.
- [ ] Add a Better Auth `databaseHooks.user.create.before` check in
  `apps/website/src/server/auth.ts` that rejects a new user unless its
  normalized email is allowed.
- [ ] Make the allowlist a current authorization boundary, not only a signup
  filter:
  - reject session creation for a user whose normalized email is not allowed,
  - re-check current admission in browser-session middleware,
  - join API-token authentication back to its owning user and reject a removed
    owner,
  - reject webhook, interaction callback, Live Activity, and other durable
    credentials when their owning user is no longer allowed.
- [ ] Add one centralized admission helper so every entry point uses identical
  normalization and denial behavior. Do not scatter independent parsers or
  comparisons through routes.
- [ ] Add an operator offboarding command or documented transaction that
  immediately revokes the removed user's sessions and API tokens, disables
  devices, and rotates or deletes service/webhook credentials. Per-request
  admission checks remain the fail-closed backstop if cleanup is incomplete.
- [ ] Treat offboarding and deletion as separate operations. Allowlist removal
  disables access and revokes all credential classes but preserves user data;
  permanent deletion requires a separate explicit account-deletion operation.
- [ ] Use the verified email in Apple's identity token as the admission key.
  Accept either a real address or an Apple relay address when that exact
  normalized address appears in the allowlist. Do not infer a hidden real
  address, map relay domains, or introduce cross-provider account linking.
- [ ] Persist the verified Apple provider subject as the stable identity key;
  treat the allowlisted email as the current admission policy rather than as a
  substitute for the provider subject.
- [ ] Return a generic denial message that does not reveal the allowlist.
- [ ] Log only the provider and denial outcome; do not log emails or tokens.

Tests:

- [ ] An allowed Apple identity using its real address can create and revisit
  the same account without duplication.
- [ ] An allowed Apple relay address can create and revisit the same account
  without exposing or requiring the underlying real address.
- [ ] An Apple identity whose returned email is not allowlisted is denied
  without creating a user, account, or session.
- [ ] An unlisted identity cannot create a user or session.
- [ ] Removing an existing user's email immediately blocks its browser session,
  API tokens, webhook URLs, interaction callbacks, and Live Activity
  credentials; the offboarding operation removes or disables the persisted
  credentials.
- [ ] Email matching is trimmed and case-insensitive.
- [ ] A production self-host starts only with a non-empty allowlist.

## Phase 4 — Create Operator-Owned Apple, Expo, and Native Identity

Complete this phase before building any installable SHark binary.

### 4.1 Apple Developer identifiers and keys

- [ ] Confirm an active paid Apple Developer Program membership; Expo documents
  this as required to generate iOS push credentials.
- [ ] Register the explicit App ID `dev.shuv.shark`.
- [ ] Enable the capabilities used by the current app:
  - Push Notifications.
  - Sign in with Apple.
  - Siri.
  - Communication Notifications entitlement, subject to the operator account's
    Apple capability availability.
  - Live Activities/frequent updates as generated by the Expo widget target.
- [ ] Register `dev.shuv.shark.widgets`.
- [ ] Register `dev.shuv.shark.notification-service` and set it explicitly as
  `bundleIdentifier` in
  `apps/expo/targets/notification-service/expo-target.config.js`. Do not derive
  the extension identity from its user-facing target name.
- [ ] Register `group.dev.shuv.shark` and associate the app and widget targets.
  This is mandatory: the current `expo-widgets` configuration declares an App
  Group unconditionally.
- [ ] Register a Sign in with Apple Services ID, recommended
  `dev.shuv.shark.web`.
- [ ] Associate the Services ID with the primary SHark App ID, register
  `shark.shuv.dev`, and add the exact return URL:
  `https://shark.shuv.dev/api/auth/callback/apple`.
- [ ] Create/download a Sign in with Apple private key and record only its key
  ID and secret-store location.
- [ ] Create/download an APNs authentication key and record only its key ID and
  secret-store location. One APNs key works in both sandbox and production.
- [ ] Never commit `.p8` key material.

### 4.2 New Expo/EAS project

- [ ] Create an Expo/EAS project owned by the operator.
- [ ] Replace the upstream fallback project ID in
  `apps/expo/app.config.ts`; production config should fail if
  `EAS_PROJECT_ID` is absent instead of silently using upstream identity.
- [ ] Update `apps/expo/app.config.ts`:
  - `name: "SHark"`
  - an operator-owned slug
  - `scheme: "shark"`
  - app, widget, and app-group identifiers
  - operator Apple Team ID
- [ ] Update `apps/expo/eas.json` with:
  - the SHark API origin for all relevant profiles,
  - the new App Store Connect app ID,
  - the new bundle identifier, app name, and SKU,
  - sandbox APNs for development and production APNs for TestFlight/store.
- [ ] Enable Expo enhanced push security and create a server access token.
- [ ] Set `EXPO_ACCESS_TOKEN` on the server.
- [ ] Let EAS create or import the operator-owned signing and APNs credentials;
  review the credential mapping before the first build.
- [ ] Update `apps/website/src/server/auth.ts` trusted origins from `hark://` to
  `shark://` while retaining `hark://` only if a compatibility build needs it.
- [ ] Update `apps/expo/src/lib/auth.ts` so the Better Auth Expo client uses
  `scheme: "shark"`. Keep its secure-storage prefix as `hark` for compatibility
  unless a deliberate credential-migration design says otherwise.
- [ ] Update native auth and deep-link tests for the new scheme.
- [ ] Update the development-only `apps/expo/app/la-lab.tsx` scheme reference
  and visible Hark sample copy so native source and generated builds contain no
  accidental upstream branding.

### 4.3 Build and inspection artifact boundary

The frozen boundary is:

- Sqim produces every simulator and development-device test build.
- XcodeBuildMCP may configure the session, install/launch an existing compatible
  artifact, describe the UI, capture screenshots, interact semantically, and
  capture focused logs, but it never compiles a test binary.
- EAS produces only the final store-signed artifact submitted to internal
  TestFlight.
- Signed entitlements are inspected on the Sqim development-device artifact and
  independently on the final EAS/TestFlight artifact.
- Sqim artifacts are deleted when superseded where supported and never retained
  longer than 30 days. Preserve only hashes and verification records after
  deletion.

Before the first XcodeBuildMCP runtime or inspection call:

1. Call `session_show_defaults`.
2. Discover/select the generated workspace, scheme, and simulator only if the
   defaults are missing or wrong.
3. Stop if the requested action would violate the frozen Sqim boundary.
4. After launch, verify the app through UI description or a screenshot before
   interaction.
5. Prefer semantic accessibility targets and capture focused app logs around
   failures.

### 4.4 App Store Connect and TestFlight

- [ ] Create the SHark app record in App Store Connect with bundle ID
  `dev.shuv.shark`.
- [ ] Supply the SHark icon and any metadata required for internal TestFlight.
  Do not invent anonymous privacy/support URLs; stop if Apple requires them.
- [ ] Keep the first release in internal TestFlight.
- [ ] Do not create or publish a public TestFlight link in v1.

Validation:

- [ ] `pnpm --filter @hark/expo exec expo config --type public` contains no
  upstream Team ID, EAS project ID, bundle ID, origin, app name, or scheme.
- [ ] Generate/prebuild the native project and audit it for upstream Team IDs,
  bundle IDs, App Groups, schemes, extension identifiers, and origins.
- [ ] Inspect the signed entitlements of both a development build and the
  TestFlight/store archive for the app, widget, and notification-service
  extension. Confirm the correct App Group, push environment, communication
  notification entitlement, Siri capability, and Live Activity capabilities;
  EAS may manage `aps-environment`, so validate the signed output rather than
  assuming the source literal is authoritative.
- [ ] `pnpm --filter @hark/expo exec expo install --check` passes.
- [ ] `npx expo-doctor` passes at the pinned reviewed version.
- [ ] A Sqim development build installs on the physical iPhone and its hosted
  install page is verified.
- [ ] A production build uploads to the new App Store Connect record and
  appears in internal TestFlight.
- [ ] Run physical-device acceptance with one allowlisted operator account on
  two iPhones, including multi-device routing, token refresh, sign-out, and
  Live Activity isolation.

## Phase 5 — Configure and Deploy the Web/API Service

### 5.1 Production configuration

- [ ] Copy `.env.example` to an untracked production environment file owned by
  the deployment user with mode `0600`.
- [ ] Update `.env.example` with SHark examples and the new required settings,
  but never real secrets.
- [ ] Set:

  ```dotenv
  APP_URL=https://shark.shuv.dev
  DATABASE_URL=/data/hark.sqlite
  NODE_ENV=production
  DEPLOYMENT_MODE=self_hosted
  ALLOWED_EMAILS=<operator email>
  BETTER_AUTH_SECRET=<generated high-entropy secret>
  APPLE_SIGN_IN_SERVICE_ID=dev.shuv.shark.web
  APPLE_SIGN_IN_BUNDLE_ID=dev.shuv.shark
  APPLE_SIGN_IN_KEY_ID=<secret metadata>
  APPLE_TEAM_ID=<secret metadata>
  APPLE_SIGN_IN_PRIVATE_KEY=<secret>
  EXPO_ACCESS_TOKEN=<secret>
  APNS_KEY_ID=<secret metadata>
  APNS_PRIVATE_KEY=<secret>
  APNS_BUNDLE_ID=dev.shuv.shark
  APNS_ENVIRONMENT=production
  SERVICE_RATE_LIMIT_PER_MINUTE=300
  ACCOUNT_RATE_LIMIT_PER_MINUTE=1500
  # TRUSTED_CLIENT_IP_HEADER intentionally unset for exe.dev v1
  ```

- [ ] Generate a unique `BETTER_AUTH_SECRET` and store it in the backup/restore
  runbook. It encrypts stored credentials; losing or rotating it blindly can
  make encrypted data unreadable.
- [ ] Remove upstream default IDs from `compose.yaml`; required operator-owned
  IDs should fail fast rather than fall back.
- [ ] Apply the Phase 3 credential matrix at startup. Production self-host mode
  must refuse to start when the allowlist or any Apple, Expo, or APNs
  credential group is missing or partial; empty Compose values count as absent.

### 5.2 exe.dev VM, proxy, TLS, and network boundary

- [ ] Create a new isolated exe.dev VM in the account's existing PDX region
  policy with 2 vCPU, 4 GB RAM, and 25 GB disk:
  - VM name: `shark-prod`.
  - Deploy directory: `/home/exedev/shark`.
- [ ] Bind Compose to loopback:
  `127.0.0.1:8787:8787`.
- [ ] Use the exe.dev managed proxy for HTTPS and select the loopback-bound
  SHark port as the public HTTP share.
- [ ] Make the exe.dev HTTP share public so Apple OAuth callbacks, webhooks,
  and the app API are reachable before SHark authentication.
- [ ] In Cloudflare, create a DNS-only CNAME from `shark.shuv.dev` to the VM's
  `*.exe.xyz` hostname.
- [ ] Register the custom domain explicitly with
  `ssh exe.dev domain add <vm> shark.shuv.dev`.
- [ ] Forward the original scheme and host required by Better Auth.
- [ ] Leave `TRUSTED_CLIENT_IP_HEADER` unset for the first release. exe.dev
  appends rather than overwrites `X-Forwarded-For`, while Hark currently reads
  the first value; trusting it would permit spoofing.
- [ ] Configure DNS and HTTPS before OAuth callback registration is tested.
- [ ] Restrict SSH and Docker host access through the operator's existing
  infrastructure controls.

### 5.3 Build and first deployment

- [ ] Build from a reviewed commit and tag the image with the full Git SHA.
- [ ] Make `/api/health` a readiness check that performs a bounded database
  query and verifies the expected migration version after startup migrations.
  Return only safe status, not schema or credential details.
- [ ] Run the container with the persistent named volume mounted at `/data`.
- [ ] Confirm startup migrations complete before the health endpoint reports
  success.
- [ ] Verify:

  ```bash
  curl --fail --silent https://shark.shuv.dev/api/health
  case "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    https://shark.shuv.dev/)" in 302|303|307|401) ;; *) exit 1 ;; esac
  case "$(curl --silent --output /dev/null --write-out '%{http_code}' \
    https://shark.shuv.dev/docs)" in 302|303|307|401) ;; *) exit 1 ;; esac
  ```

- [ ] Confirm authenticated missing website paths return a real `404`, while API
  and webhook misses return JSON `404`.
- [ ] Confirm secret webhook URLs are redacted in access logs.
- [ ] Retain only seven days of capped, rotating logs on `shark-prod`; do not add
  centralized logging in v1. Redact emails, tokens, webhook URLs, push
  identifiers, authorization codes, callback credentials, and private-key
  material.

### 5.4 Restic backup and restore to rsync.net

- [ ] Adapt the safe WAL checkpoint and `integrity_check` logic from
  `.github/workflows/production-update.yml`.
- [ ] Before each deployment:
  - stop or quiesce the app,
  - open `/data/hark.sqlite`,
  - run `wal_checkpoint(TRUNCATE)`,
  - copy the main database,
  - open the copy read-only,
  - require `integrity_check = ok`,
  - require the exact expected migration version and required table set rather
    than the current weak `c < 5` table-count guard.
- [ ] Create a dedicated rsync.net Restic repository reachable over SFTP.
- [ ] Use the account-relative repository suffix `repos/shark-prod`; keep the
  rsync.net account and host values in the SHark Bitwarden project, readable
  only by the backup machine account.
- [ ] Use Restic encryption for every off-host snapshot; do not upload the
  plaintext checkpoint copy.
- [ ] Run a verified snapshot nightly at 2:00 AM `America/Los_Angeles` and an
  additional verified snapshot before every deployment.
- [ ] Use this retention policy:
  7 daily, 4 weekly, and 6 monthly verified backups.
- [ ] Store the only copy of the Restic repository password in Bitwarden
  Secrets Manager. There is intentionally no offline or second-vault copy;
  Bitwarden recovery is therefore a documented disaster-recovery dependency.
- [ ] Back up production secret references separately; never place plaintext
  secrets in the repository or database archive.
- [ ] Perform a quarterly restore drill into a disposable Compose project and
  verify account, services, devices, events, and schema. Do not add separate
  weekly or monthly repository-check jobs in v1.
- [ ] Document recovery behavior when push tokens have expired: reopening the
  app should re-register the device.

### 5.5 Deployment automation and rollback

- [x] Create one dedicated Bitwarden Secrets Manager project named `shark`
  (`cda1aac8-67e1-498a-9d5c-b49401517ca8`) as the production secret source of
  truth.
- [ ] Create two read-only runtime machine accounts with direct, disjoint secret
  grants: application credentials for the app account and Restic credentials
  for the backup account. Grant neither account whole-project access, do not
  install the broader provisioning identity on production, and do not use a
  personal-vault CLI session.
- [ ] Make `shark-prod` fetch its own scoped application secrets directly from
  Bitwarden during deployment. GitHub receives no Apple, APNs, Expo, database,
  Restic, or application secrets.
- [ ] Use a manual-dispatch GitHub Actions workflow only to verify, build,
  publish, and attest the exact `main` image in GHCR. GitHub stores no
  production shell or VM credential and cannot perform the cutover.
- [ ] Make the GHCR package public so `shark-prod` can pull it without a
  registry credential; the image contains no secrets or private source.
- [ ] Require the operator to invoke the root-owned promotion helper through
  their existing exe.dev identity with the reviewed full SHA and exact image
  digest. Do not add a deployment listener, self-hosted runner, or public route.
- [ ] Before touching the running service, verify the OCI attestation against
  `shuv1337/shark`, the production publisher workflow, `refs/heads/main`, the
  selected source SHA, and a GitHub-hosted runner.
- [ ] Replace upstream-specific values in
  `.github/workflows/production-update.yml`:
  host, deploy path, environment name, compose project/volume names, domain,
  smoke-test strings, and secret names.
- [ ] Explicitly remove `raven-cobra.exe.xyz`, `/home/exedev/hark`, and the
  `/pricing` smoke assertion for “100,000 notifications per month”; the
  self-hosted deployment must not retain or merely reword that paid-plan gate.
- [ ] Gate deployment on typecheck, tests, lint, build, database backup
  verification, and image build.
- [ ] Deploy an immutable image selected through an explicit Compose image
  reference of the form `ghcr.io/shuv1337/shark@sha256:<digest>`.
- [ ] Retain every digest named by a recorded rollback candidate on the
  production host.
- [ ] Record the reviewed source SHA, image tag, and image digest together.
  Verify that the built image came from that source and that Compose is running
  the recorded digest before declaring deployment successful.
- [ ] Rollback procedure:
  1. stop the current container,
  2. select the previous recorded SHA tag and verify its digest,
  3. restore the pre-deploy database only if the new migration is incompatible,
  4. start the previous image,
  5. confirm Compose is running the selected digest,
  6. verify health, auth, dashboard, and a test notification.
- [ ] Keep rollback manual for the first releases; automate only after a real
  drill succeeds.

## Phase 6 — Adapt CLI, Skill, and Documentation for SHark

### 6.1 CLI

- [ ] Change `DEFAULT_API_URL` in `packages/harkctl/src/cli.mjs` to the SHark
  origin so the operator does not need `HARK_API_URL` for routine use.
- [ ] Keep explicit `HARK_API_URL` override behavior and its security warning.
- [ ] Change user-facing default titles and help text to SHark.
- [ ] Keep the `harkctl` executable, config locations, token validation, and
  `HARK_*` environment names for the first milestone.
- [ ] Update `packages/harkctl/README.md` with the SHark origin and local
  installation path.
- [ ] Do not publish the fork over the upstream `harkctl` npm package.
- [ ] Optionally add a second `sharkctl` bin alias only after end-to-end proof;
  both names must execute identical reviewed code and share the same secure
  config.

### 6.2 Agent skill

- [ ] Create a SHark-facing skill package or rename `skills/hark` to
  `skills/shark` while preserving the upstream license.
- [ ] Update the skill description, reviewed CLI version/source, default
  origin, allowed webhook-origin checks, and examples.
- [ ] Retain the strong existing security boundaries:
  - tokens and webhook URLs are secrets,
  - no token on argv,
  - external notification/reply content is untrusted,
  - retry mutations use idempotency keys,
  - a non-default API origin is used only when explicitly trusted.
- [ ] Install the skill directly from the operator fork or a local reviewed
  checkout; do not publish until the install/update story is deliberate.
- [ ] Ensure example GitHub Actions validate
  `https://shark.shuv.dev/hooks/*`.

### 6.3 Product docs

- [ ] Update `README.md`, website docs, generated `docs.md`, and `llms.txt`.
- [ ] Document the self-host architecture, account allowlist, backup/restore,
  credentials, and TestFlight installation.
- [ ] Document Apple-only authentication, exact-email admission for either a
  real or relay address, and the operator offboarding procedure for revoking
  every credential class.
- [ ] Clearly distinguish:
  - Expo Push Service for ordinary notifications.
  - Direct APNs credentials for Live Activities.
- [ ] Document that `HARK_*` and `harkctl` are compatibility names.
- [ ] Remove paid-plan claims and replace them with the configured self-hosted
  limits.

Validation:

- [ ] CLI authentication opens the SHark authorization page.
- [ ] CLI config and output never print access tokens or webhook secrets beyond
  the one intentional service-creation response.
- [ ] The skill contains no upstream production origin except attribution.
- [ ] Docs examples work when copied against the SHark deployment.

## Phase 7 — End-to-End Acceptance Matrix

### Web and auth

- [ ] Health-check endpoints are the only anonymously readable content in v1.
- [ ] Landing, docs, privacy, terms, dashboard, and CLI authorization require an
  allowlisted Apple session and display SHark with correct canonical metadata.
- [ ] OAuth callbacks, webhooks, interaction callbacks, and Live Activity
  endpoints remain network-reachable but authenticate through signed state or
  their scoped credentials; they are not anonymous content surfaces.
- [ ] Sign in with Apple works on web and iOS.
- [ ] An allowlisted real Apple email signs into the same account on repeat.
- [ ] An allowlisted Apple relay email signs into the same account on repeat
  without requiring or exposing the underlying real address.
- [ ] A non-allowlisted account is denied without being persisted.
- [ ] Removing an existing allowed email blocks its current browser session,
  API tokens, webhook URLs, interaction callbacks, and Live Activity
  credentials before cleanup, then the offboarding operation revokes, disables,
  rotates, or deletes all persisted access.
- [ ] Sign-out unregisters the device.
- [ ] Account deletion removes services, devices, sessions, and Apple grants.
- [ ] Apple-only UI contains no Google button, provider configuration, startup
  requirement, documentation, or test expectation.
- [ ] If App Store Connect requires an anonymously reachable privacy/support URL
  for this internal-only build, stop and return for a scope decision rather than
  publishing another SHark page implicitly.

### iOS presentation and state

- [ ] Verify signed-out, authentication-busy, authentication-error,
  notification-denied, registration-error, offline/stale, and ready states.
- [ ] Verify primary controls through semantic accessibility labels/roles and
  VoiceOver, including sign in, notification permission, device registration,
  refresh, sign out, and account deletion.
- [ ] Verify large Dynamic Type does not truncate required actions or identity
  text, and capture screenshots for the primary light appearance.
- [ ] Keep the React Native view tree stable and localize loading/error state;
  do not introduce SwiftUI view-model/refactor work into the main Expo client.

### Ordinary push

- [ ] Register a physical iPhone and confirm the server stores the new Expo
  token and APNs token.
- [ ] Create a service in the dashboard.
- [ ] POST the smallest webhook payload and receive one notification.
- [ ] Verify service title, avatar, body, tap URL, and communication-style
  presentation.
- [ ] Verify duplicate retry with the same `Idempotency-Key` does not create a
  duplicate event.
- [ ] Verify an expired device token is deactivated without leaking the token
  into the HTTP response or logs.

### Interactions

- [ ] Send Approve/Deny, Yes/No, and text prompts from `harkctl`.
- [ ] Answer from the notification action and verify the waiting CLI receives
  the terminal result.
- [ ] Verify expiration, cancellation, timeout, and callback retry behavior.
- [ ] Treat text replies as untrusted data throughout the agent skill.

### Live Activities

- [ ] Confirm the device registers a push-to-start token in the matching
  sandbox/production environment.
- [ ] Start each shipped layout: standard, ring, hero, terminal, and steps.
- [ ] Update status, detail, progress, color, and style.
- [ ] Verify optimistic sequence rejection for stale updates.
- [ ] End immediately and with delayed dismissal.
- [ ] Verify `replace: true` takes over the single SHark activity slot.
- [ ] Verify Lock Screen and Dynamic Island rendering on the physical device.

### CLI and skill

- [ ] Authenticate with the browser device-code flow.
- [ ] Verify config file mode `0600`.
- [ ] Exercise `notify`, `notify ask`, `interaction wait`, `activity`, devices,
  and services.
- [ ] Verify revoke/logout removes access immediately.
- [ ] Run an agent workflow that sends completion, requests one approval, and
  reports progress through a Live Activity.

### Operations

- [ ] Restart the container and confirm data, sessions, services, and device
  registration persist.
- [ ] Deploy a no-op release through the production workflow.
- [ ] Verify a database backup and restore drill.
- [ ] Roll back one release using the documented procedure.
- [ ] Confirm no secret, push token, webhook token, OAuth token, `.p8` content,
  or plaintext callback credential appears in Git, CI logs, container logs, or
  the visual artifacts.

## Phase 8 — Release and Ongoing Upstream Maintenance

- [ ] Tag the first proven release, for example `shark-v0.1.0`.
- [ ] Record exact web image SHA, iOS EAS build ID, App Store Connect build
  number, deployed Git SHA, migration number, and backup identifier.
- [ ] Keep the first external boundary at internal TestFlight plus the private
  production origin.
- [ ] Do not add proactive monitoring or alerts in v1. Document a manual
  operator check for `/api/health`, deployment status, backup completion, disk
  pressure, and container restarts.
- [ ] Review Expo push receipts and deactivate `DeviceNotRegistered` tokens.
- [ ] Schedule the confirmed quarterly restore drill.
- [ ] Before merging upstream changes:

  ```bash
  git fetch upstream
  git log --oneline HEAD..upstream/main
  git diff --stat HEAD...upstream/main
  ```

- [ ] Rebase or merge upstream deliberately, resolve conflicts around the small
  SHark brand/config layer, rerun the full baseline and physical-device smoke
  tests, then deploy.
- [ ] Keep a short `docs/upstream-delta.md` listing intentional fork deltas:
  brand, external identities, self-host entitlements, allowlist, and deployment.
- [ ] Never collapse future reviewed branch stacks directly into `main`; if
  multiple open changes depend on each other, inspect and operate them with the
  local `stack` CLI.

## Implementation Order and Milestones

### Milestone A — Safe branded source

Complete Phases 0–3.

Exit criteria:

- All visible local web/app surfaces say SHark and use the canonical Devil
  Phone.
- Internal compatibility identifiers remain stable.
- Self-host mode enables the complete feature set.
- Production self-host mode requires an account allowlist.
- Removing an address blocks every existing credential path and the offboarding
  operation clears its persisted access.
- Apple-only authentication admits the exact allowlisted verified email,
  including a relay address, without duplicate accounts.
- Full automated baseline passes.

### Milestone B — Operator-owned mobile identity

Complete Phase 4.

Exit criteria:

- No upstream Apple, Expo, OAuth, TestFlight, or App Store identifier remains
  active in configuration.
- A SHark development build installs and authenticates on both physical
  iPhones for the one allowlisted operator account.
- Normal push and Live Activity credentials belong to the operator.

### Milestone C — Recoverable production service

Complete Phase 5.

Exit criteria:

- `https://shark.shuv.dev` is healthy behind TLS and loopback-bound Compose.
- Only currently allowlisted accounts and their credentials can enter.
- The running container digest matches the recorded image built from the
  reviewed Git SHA.
- Backup, restore, deploy, and rollback procedures are proven rather than
  merely documented.

### Milestone D — Complete operator workflow

Complete Phases 6–7.

Exit criteria:

- CLI and skill target SHark by default.
- All web, push, interaction, Live Activity, deep-link, and deletion paths pass.
- No credential or user content leaks through code, logs, or artifacts.

### Milestone E — First release and maintenance loop

Complete Phase 8.

Exit criteria:

- A tagged SHark release is installed through internal TestFlight.
- Production version/build/database/backup provenance is recorded.
- Manual operational checks and upstream-sync procedures are documented.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| PolyForm noncommercial scope is exceeded | License violation | Keep the service personal/noncommercial or obtain a commercial license first |
| Residual Autumn or paid-plan code survives the fork | Core features remain coupled to removed commercial behavior | Remove Autumn runtime/configuration and test one fixed self-hosted entitlement mode |
| Public OAuth creates unwanted accounts | Abuse and unexpected push costs | Require an exact email allowlist and fail production startup when absent |
| Removing an email leaves issued credentials valid | Formerly allowed access persists | Check admission on every credential path and run transactional offboarding |
| Apple relay identity is mistaken for an invalid or temporary address | Apple lockout or duplicate user | Accept the exact verified relay address when allowlisted and persist the Apple provider subject |
| Upstream EAS/Apple IDs remain | Builds or pushes target the wrong owner | Remove all fallback IDs and make operator-owned IDs required |
| Expo project and push token mismatch | Ordinary pushes fail | Create a new EAS project and obtain tokens with its exact project ID |
| APNs environment mismatch | Live Activities silently fail | Use sandbox for development, production for TestFlight/store, and test both |
| SQLite backup ignores WAL | Backup appears valid but loses data | Checkpoint, copy, open read-only, run integrity and schema checks |
| Mutable or unretained images make rollback fictional | Previous code cannot be restored reliably | Record and retain immutable SHA tags and verify image digests |
| Rebranding cryptographic/internal namespaces | Credentials and migrations break | Preserve token domains, tables, package names, and routes |
| Internal-TestFlight metadata retains stale claims/assets | Misleading operator-facing release metadata | Remove upstream TestFlight/demo/paid claims and use accurate SHark metadata |
| Devil Phone provenance is assumed from an unrelated notice file | Unclear right to reuse the artwork | Record positive operator ownership and source provenance |
| Devil Phone app icon has alpha or unsafe crop | Build/store rejection or bad mask | Generate an opaque 1024px icon from the safe-area composition and inspect on device |
| Fork drifts far from upstream | Expensive future updates | Keep a narrow brand/config layer and document intentional deltas |

## External References

- Upstream source:
  https://github.com/R44VC0RP/hark
- Operator fork:
  https://github.com/shuv1337/shark
- PolyForm Noncommercial 1.0.0:
  https://polyformproject.org/licenses/noncommercial/1.0.0/
- Apple — Register an App ID:
  https://developer.apple.com/help/account/identifiers/register-an-app-id/
- Apple — Configure Sign in with Apple:
  https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple
- Apple — Private email relay:
  https://developer.apple.com/documentation/signinwithapple/communicating-using-the-private-email-relay-service
- Apple — APNs authentication tokens:
  https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens/
- Expo — Push notification setup:
  https://docs.expo.dev/push-notifications/push-notifications-setup/
- Expo — Sending notifications and enhanced push security:
  https://docs.expo.dev/push-notifications/sending-notifications/
- Expo — EAS Submit for iOS:
  https://docs.expo.dev/submit/ios/
- Expo — app icon appearance variants:
  https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/
- Better Auth — Database hooks:
  https://better-auth.com/docs/concepts/database
- Better Auth — Account linking options:
  https://better-auth.com/docs/reference/options

## Final Definition of Done

SHark is done when an allowlisted operator can install an operator-signed SHark
TestFlight build bearing the Devil Phone icon, sign in through the SHark domain,
register the iPhone, create a webhook, receive a branded communication
notification, answer an interactive prompt, run and end a Live Activity, and
perform the same flows from the reviewed CLI/skill—while the service survives a
restart, has a verified off-host backup and tested rollback, contains no
upstream external identity, exposes no unauthorized signup or continued access
after allowlist removal, enforces the documented Apple identity policy without
duplicate users, runs the recorded immutable image digest, and passes the full
automated baseline at the deployed Git SHA.
