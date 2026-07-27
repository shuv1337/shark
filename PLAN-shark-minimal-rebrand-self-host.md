# SHark Minimal Rebrand and Self-Hosting Plan

## Objective

Fork the current Hark codebase into a personally operated, noncommercial SHark
deployment with:

- SHark as the user-facing product name.
- The canonical red Devil Phone artwork from
  `/home/shuv/repos/codex-quota/web/icons/devil-phone.svg`.
- A new iOS app, Apple identifiers, Expo project, OAuth clients, and push
  credentials owned by the SHark operator.
- A single-host Docker Compose deployment behind HTTPS.
- All Hark capabilities enabled for the self-hosted operator without depending
  on Autumn billing.
- Production access restricted to an explicit account allowlist.
- The smallest practical patch surface so upstream Hark changes remain easy to
  merge.

This plan is based on local commit
`0c0d4e3de0752ee91d2a17dee83a313f6863d6a8`, which matched both
`origin/main` and `upstream/main` on 2026-07-26.

## Executive Recommendation

Use `https://shark.shuv.dev` as the working production origin and
`dev.shuv.shark` as the working iOS bundle identifier. Start with private
TestFlight distribution, prove every push and Live Activity path on a physical
iPhone, and only then decide whether a public App Store listing is useful.

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
2. A fail-closed email allowlist so exposing the OAuth endpoints does not
   create a public signup service.

## Verified Current State

### Repository and upstream

- The working tree was clean before this plan was added.
- `origin` is `git@github.com:shuv1337/hark.git`.
- `upstream` is `git@github.com:R44VC0RP/hark.git`.
- Both remotes and the local branch pointed to `0c0d4e3`.
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
  account to create a user.
- An email allowlist applied only when a user or session is created would not
  revoke existing browser sessions, API tokens, webhook URLs, interaction
  credentials, or Live Activity credentials.
- Sign in with Apple may return a private relay address rather than the Google
  address. Exact-email admission therefore needs an explicit Apple identity
  policy before accounts are created.
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
- New domain, Apple/Expo/Google identities, signing, push, and TestFlight.
- Explicit self-host entitlements and account allowlisting.
- Docker Compose deployment, proxy/TLS, secrets, backup, restore, deployment,
  monitoring, and rollback.
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

## Decisions to Confirm Before Implementation

The plan can proceed with the recommended defaults, but these values should be
frozen in one short decision record before credentials are created:

| Decision | Recommended default | Why |
| --- | --- | --- |
| Production origin | `https://shark.shuv.dev` | Short, branded, and under an existing operator domain |
| iOS bundle ID | `dev.shuv.shark` | Stable reverse-DNS identifier owned by the operator |
| Widget bundle ID | `dev.shuv.shark.widgets` | Must be unique and derived from the app ID |
| App Group | `group.dev.shuv.shark` | Keeps app/widget sharing under the same namespace |
| URL scheme | `shark` | Makes native auth and development deep links branded |
| Distribution | Private TestFlight first | Fastest trustworthy path to a real-device proof |
| Authentication | Google and Apple | Preserves current UX and avoids store-policy surprises |
| Account admission | Exact email allowlist, enforced at every credential-bearing entry point | Prevents both new signup and continued use after removal |
| Apple identity policy | Require “Share My Email” and an exact match for the first release | Preserves one Google/Apple user without adding a broader different-email linking mechanism |
| Paid tiers | Disabled; self-host gets full capability | Removes Autumn without breaking core features |
| UI palette | Preserve existing Hark UI colors | Limits scope; Devil Phone becomes the identifying mark |
| CLI name | Keep `harkctl` initially | Avoids package/config/token churn while still supporting SHark |

If a different domain or bundle ID is selected, substitute it everywhere in
Phases 1–5 before creating any external identifiers. Bundle IDs cannot be
casually renamed after app distribution begins.

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
  artwork. The source repository's
  `/home/shuv/repos/codex-quota/web/icons/THIRD_PARTY_NOTICES.md` explicitly
  says that the Devil Phone artwork is not covered by its third-party notices;
  do not treat that file as a license grant or copy a nonexistent applicable
  notice.
- [ ] Replace the upstream operator-specific privacy policy and terms in
  `apps/website/src/client/pages/Legal.tsx` with accurate SHark operator,
  hosting, retention, subprocessors, contact, and account-deletion language.
- [ ] Do not retain claims about paid plans or the original operator's service.

Validation:

- [ ] `rg -n "Ryan Vogel|R44VC0RP|hark\\.ryan\\.ceo|Hark Pro|\\$8|mandarin3d|Stripe|Autumn"`
  returns only deliberate attribution, historical, test-fixture, or
  compatibility references.
- [ ] The deployed privacy URL and support URL are ready before TestFlight
  external testing or App Store submission.

## Phase 1 — Introduce the Minimal SHark Brand Layer

### 1.1 Canonical brand and origins

- [ ] Add a small website brand module, for example
  `apps/website/src/shared/brand.ts`, containing the user-facing product name,
  public site URL, source repository URL, operator name, and support URL.
- [ ] Make `apps/website/src/shared/seo.ts`,
  `apps/website/src/shared/docs/content.ts`,
  `apps/website/src/shared/docs/markdown.ts`, and
  `apps/website/scripts/prerender-docs.tsx` consume the shared values where
  practical.
- [ ] Keep one fixed production origin for this personal deployment rather than
  building a general white-label system.
- [ ] Update `apps/website/public/robots.txt` and
  `apps/website/public/sitemap.xml`, or generate them during the existing
  prerender step so the canonical origin cannot drift.
- [ ] Change `/oss` in `apps/website/src/server/app.ts` to the SHark fork URL.

### 1.2 Product-facing copy

- [ ] Replace visible “Hark” with “SHark” in:
  - `apps/website/index.html`
  - `apps/website/src/client/pages/Landing.tsx`
  - `apps/website/src/client/pages/Docs.tsx`
  - `apps/website/src/client/pages/Pricing.tsx`
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
- [ ] Update SEO structured data in `apps/website/src/shared/seo.ts` with SHark
  ownership, URLs, name, and repository.
- [ ] Remove the upstream TestFlight URL and original demo/store identifiers
  until SHark replacements exist.
- [ ] Replace Free/Pro marketing with a single “Self-hosted” capability
  explanation, or remove `/pricing` from public navigation and sitemap.

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

- [ ] Add/adjust SEO and docs tests so every canonical URL uses the SHark
  origin.
- [ ] Run the exhaustive branding audit:

  ```bash
  rg -n -i --hidden -g '!.git' -g '!pnpm-lock.yaml' \
    'Hark|hark\.ryan\.ceo|ceo\.ryan\.hark|R44VC0RP|PjCnKETB|9G68SMNHEU|0fce08a7|6794121509|raven-cobra|exe\.xyz|exedev|mandarin3d'
  ```

- [ ] Classify every remaining match as compatibility, attribution, a test
  fixture, or a defect.

## Phase 2 — Build the Devil Phone Asset Pipeline

Use the canonical source:

```text
/home/shuv/repos/codex-quota/web/icons/devil-phone.svg
SHA-256: 3489212420a5c2cbaa56cec28933b1e1284739b11e3388650ea3fb8a4a7e9f69
```

The existing safe-area raster reference is:

```text
/home/shuv/repos/codex-quota/web/icons/icon-maskable-512.png
SHA-256: 5d3fa36bb3865110761752c978b811d0b44755e44a99376acf6c9f453af9af1e
```

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
- [ ] Favicon, header, Open Graph image, splash screen, Expo development build,
  and TestFlight build all display the same canonical mark.
- [ ] Inspect the app icon on a physical iPhone in both light and dark Home
  Screen contexts.

## Phase 3 — Add Explicit Self-Hosted Product Semantics

### 3.1 Self-host entitlement mode

- [ ] Add an explicit environment setting in
  `apps/website/src/server/env.ts`, preferably
  `DEPLOYMENT_MODE=hosted|self_hosted`, defaulting to `hosted`.
- [ ] Normalize optional string environment values centrally before validation:
  trim whitespace, convert empty strings to `undefined`, split and deduplicate
  comma-separated emails, and lowercase email comparisons. This is required
  because Compose currently supplies absent optional values as empty strings.
- [ ] In production, reject contradictory configuration such as
  `DEPLOYMENT_MODE=self_hosted` plus `AUTUMN_API_KEY`.
- [ ] Define and test a per-mode startup credential matrix:
  - hosted development/test may use documented local defaults,
  - hosted production retains its existing Autumn behavior,
  - self-hosted production requires a non-empty allowlist plus complete Google,
    Apple, Expo, and APNs credential groups,
  - a partially configured credential group is always an error,
  - self-hosted production with Autumn configured is always an error.
- [ ] Refactor `apps/website/src/server/lib/billing.ts` so self-hosted mode
  returns:
  - `plan: "pro"` for compatibility with existing capability checks.
  - `features.deviceRouting: true`.
  - Unlimited devices.
  - The existing numeric `limits.notificationsPerMonth` compatibility value so
    `BillingDto` does not change, but `usage.notificationsRemaining: null`.
  - Unconditional notification allowance and no Autumn notification tracking;
    the numeric compatibility value is never enforced as a monthly meter.
  - Explicit, configurable per-minute abuse limits.
  - `configured: false` so no checkout or portal button appears.
- [ ] Keep hosted/free/Autumn behavior unchanged when
  `DEPLOYMENT_MODE=hosted`.
- [ ] Rename user-facing “Pro” errors and labels to capability-oriented wording
  in self-hosted mode where the API contract permits it.
- [ ] Remove or hide checkout, portal, and upgrade controls for self-hosted
  deployments.
- [ ] Keep the API routes returning deliberate `503 Billing is not configured`
  if called directly, unless removing the routes is cleaner.

Tests:

- [ ] Add unit tests for hosted-without-Autumn, hosted-with-Autumn, and
  self-hosted entitlement results.
- [ ] Add client tests proving the self-hosted billing state renders as
  unmetered/self-hosted rather than as a numeric paid-plan allowance.
- [ ] Add route tests proving self-hosted accounts can:
  - register multiple devices,
  - target devices,
  - create approval/text interactions,
  - start/update/end Live Activities.
- [ ] Add startup tests for the full credential matrix, contradictory
  deployment/billing settings, empty and whitespace-only values, duplicate
  emails, and case-variant emails.

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
- [ ] For the first release, require Apple “Share My Email” and require its
  normalized address to equal the allowed Google address. Reject Apple private
  relay addresses generically without persisting a user. Do not enable
  `allowDifferentEmails` or implicit provider-subject mapping until a deliberate
  account-linking design replaces this policy.
- [ ] Return a generic denial message that does not reveal the allowlist.
- [ ] Log only the provider and denial outcome; do not log emails or tokens.

Tests:

- [ ] An allowed Google identity can create the account, and Apple with “Share
  My Email” links/signs into that same user without creating a duplicate.
- [ ] An Apple private relay address is denied without creating a user, account,
  or session, and the UI explains the operator action without revealing the
  allowlist.
- [ ] An unlisted identity cannot create a user or session.
- [ ] Removing an existing user's email immediately blocks its browser session,
  API tokens, webhook URLs, interaction callbacks, and Live Activity
  credentials; the offboarding operation removes or disables the persisted
  credentials.
- [ ] Email matching is trimmed and case-insensitive.
- [ ] A production self-host starts only with a non-empty allowlist.

## Phase 4 — Create Operator-Owned Apple, Expo, Google, and Native Identity

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

### 4.2 Google OAuth

- [ ] Create a dedicated Google OAuth Web Application client for SHark.
- [ ] Add:
  `https://shark.shuv.dev/api/auth/callback/google`.
- [ ] Add only the HTTPS development callback actually used; do not add broad
  wildcard origins.
- [ ] Store the client ID and secret in the deployment secret store.

### 4.3 New Expo/EAS project

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
- [ ] Update native auth and deep-link tests for the new scheme.
- [ ] Update the development-only `apps/expo/app/la-lab.tsx` scheme reference
  and visible Hark sample copy so native source and generated builds contain no
  accidental upstream branding.

### 4.4 App Store Connect and TestFlight

- [ ] Create the SHark app record in App Store Connect with bundle ID
  `dev.shuv.shark`.
- [ ] Supply the SHark icon, privacy URL, support URL, category, age rating,
  export-compliance answer, and account-deletion instructions.
- [ ] Keep the first release in internal TestFlight.
- [ ] Do not publish a public TestFlight link in the website until the app is
  stable and the operator intends to support external testers.

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
- [ ] An EAS development build installs on the physical iPhone.
- [ ] A production build uploads to the new App Store Connect record and
  appears in internal TestFlight.

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
  GOOGLE_CLIENT_ID=<secret>
  GOOGLE_CLIENT_SECRET=<secret>
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
  TRUSTED_CLIENT_IP_HEADER=<only if overwritten by the proxy>
  ```

- [ ] Generate a unique `BETTER_AUTH_SECRET` and store it in the backup/restore
  runbook. It encrypts stored credentials; losing or rotating it blindly can
  make encrypted data unreadable.
- [ ] Remove upstream default IDs from `compose.yaml`; required operator-owned
  IDs should fail fast rather than fall back.
- [ ] Apply the Phase 3 credential matrix at startup. Production self-host mode
  must refuse to start when the allowlist or any Google, Apple, Expo, or APNs
  credential group is missing or partial; empty Compose values count as absent.

### 5.2 Reverse proxy, TLS, and network boundary

- [ ] Bind Compose to loopback:
  `127.0.0.1:8787:8787`.
- [ ] Terminate TLS at the operator's trusted reverse proxy.
- [ ] Route `shark.shuv.dev` to `http://127.0.0.1:8787`.
- [ ] Forward the original scheme and host required by Better Auth.
- [ ] If client-IP-aware rate limiting is needed, configure one header that the
  edge always overwrites, then set exactly that name in
  `TRUSTED_CLIENT_IP_HEADER`.
- [ ] Otherwise leave `TRUSTED_CLIENT_IP_HEADER` unset; never trust arbitrary
  client-supplied `X-Forwarded-For`.
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
  curl --fail --silent https://shark.shuv.dev/
  curl --fail --silent https://shark.shuv.dev/docs
  ```

- [ ] Confirm missing website paths return a real `404`, while API and webhook
  misses return JSON `404`.
- [ ] Confirm secret webhook URLs are redacted in access logs.

### 5.4 Backup and restore

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
- [ ] Encrypt backups off-host.
- [ ] Use a documented retention policy, recommended:
  7 daily, 4 weekly, and 6 monthly verified backups.
- [ ] Back up the production env/secret references separately; never place
  plaintext secrets in the repository or database archive.
- [ ] Perform a restore drill into a disposable Compose project and verify
  account, services, devices, events, and schema.
- [ ] Document recovery behavior when push tokens have expired: reopening the
  app should re-register the device.

### 5.5 Deployment automation and rollback

- [ ] Replace upstream-specific values in
  `.github/workflows/production-update.yml`:
  host, deploy path, environment name, compose project/volume names, domain,
  smoke-test strings, and secret names.
- [ ] Explicitly remove `raven-cobra.exe.xyz`, `/home/exedev/hark`, and the
  `/pricing` smoke assertion for “100,000 notifications per month”; the
  self-hosted deployment must not retain or merely reword that paid-plan gate.
- [ ] Keep CI source sync from deleting `.env`, `/data`, generated native
  folders, or backups.
- [ ] Gate deployment on typecheck, tests, lint, build, database backup
  verification, and image build.
- [ ] Deploy an immutable image selected through an explicit Compose image
  reference, for example `image: shark:${DEPLOY_GIT_SHA}` in an operator
  override or generated deployment file.
- [ ] Choose and document one image-retention mechanism:
  - push `shark:<full-git-sha>` to an operator-controlled registry and pin its
    digest at deploy time, or
  - retain the same immutable SHA tags on the production host with a pruning
    policy that preserves every rollback candidate.
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
- [ ] Document the “Share My Email” first-release policy, how a denied Apple
  private relay login is corrected, and the operator offboarding procedure for
  revoking every credential class.
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

- [ ] Landing, docs, privacy, terms, dashboard, and CLI authorization display
  SHark and the Devil Phone with correct canonical metadata.
- [ ] Google sign-in works on web and iOS.
- [ ] Sign in with Apple works on web and iOS.
- [ ] Google plus Apple “Share My Email” resolve to the same allowed user and do
  not create duplicate accounts.
- [ ] Apple Hide My Email/private relay is denied without persisting a user,
  account, or session, and the operator-facing recovery instructions work.
- [ ] A non-allowlisted account is denied without being persisted.
- [ ] Removing an existing allowed email blocks its current browser session,
  API tokens, webhook URLs, interaction callbacks, and Live Activity
  credentials before cleanup, then the offboarding operation revokes, disables,
  rotates, or deletes all persisted access.
- [ ] Sign-out unregisters the device.
- [ ] Account deletion removes services, devices, sessions, and Apple grants.

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
- [ ] Add uptime monitoring for `/api/health` and a synthetic landing-page
  check that verifies the SHark canonical URL. Alert separately when the
  database-backed readiness check fails.
- [ ] Alert on repeated push-provider failures, authentication failures, disk
  pressure, container restart loops, and backup verification failures without
  logging secrets.
- [ ] Review Expo push receipts and deactivate `DeviceNotRegistered` tokens.
- [ ] Schedule a restore drill at least quarterly.
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
- Google and Apple “Share My Email” resolve to one user; private relay is denied
  without persistence under the frozen first-release policy.
- Full automated baseline passes.

### Milestone B — Operator-owned mobile identity

Complete Phase 4.

Exit criteria:

- No upstream Apple, Expo, OAuth, TestFlight, or App Store identifier remains
  active in configuration.
- A SHark development build installs and authenticates on the physical iPhone.
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
- Monitoring and upstream-sync procedures are operational.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| PolyForm noncommercial scope is exceeded | License violation | Keep the service personal/noncommercial or obtain a commercial license first |
| Empty Autumn key is mistaken for full self-hosting | Core features return 402 | Add explicit, tested `self_hosted` entitlement mode |
| Public OAuth creates unwanted accounts | Abuse and unexpected push costs | Require an exact email allowlist and fail production startup when absent |
| Removing an email leaves issued credentials valid | Formerly allowed access persists | Check admission on every credential path and run transactional offboarding |
| Apple Hide My Email conflicts with exact-email admission | Apple lockout or duplicate user | Require Share My Email for the first release and reject relay addresses without persistence |
| Upstream EAS/Apple IDs remain | Builds or pushes target the wrong owner | Remove all fallback IDs and make operator-owned IDs required |
| Expo project and push token mismatch | Ordinary pushes fail | Create a new EAS project and obtain tokens with its exact project ID |
| APNs environment mismatch | Live Activities silently fail | Use sandbox for development, production for TestFlight/store, and test both |
| SQLite backup ignores WAL | Backup appears valid but loses data | Checkpoint, copy, open read-only, run integrity and schema checks |
| Mutable or unretained images make rollback fictional | Previous code cannot be restored reliably | Record and retain immutable SHA tags and verify image digests |
| Rebranding cryptographic/internal namespaces | Credentials and migrations break | Preserve token domains, tables, package names, and routes |
| App Store review discovers stale claims/assets | Rejection or misleading listing | Remove upstream TestFlight/demo/paid claims and use accurate SHark legal pages |
| Devil Phone provenance is assumed from an unrelated notice file | Unclear right to reuse the artwork | Record positive operator ownership and source provenance |
| Devil Phone app icon has alpha or unsafe crop | Build/store rejection or bad mask | Generate an opaque 1024px icon from the safe-area composition and inspect on device |
| Fork drifts far from upstream | Expensive future updates | Keep a narrow brand/config layer and document intentional deltas |

## External References

- Upstream source:
  https://github.com/R44VC0RP/hark
- Operator fork:
  https://github.com/shuv1337/hark
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
