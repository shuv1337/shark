# SHark v1 operator provisioning gates

This is a non-secret checklist for external state that cannot be created from the reviewed
repository alone. Never add tokens, private keys, verified operator email addresses, device
identifiers, or account recovery material to this file.

## Frozen identities

| Resource | Value | Current evidence |
| --- | --- | --- |
| Apple Team | `7H54B326YZ` | Authenticated App Store Connect API profile |
| Primary App ID | `dev.shuv.shark` | Apple resource `8M9ZYK5NRH` exists |
| Widget App ID | `dev.shuv.shark.widgets` | Apple resource `Y67RVQMY6J` exists |
| Notification extension App ID | `dev.shuv.shark.notification-service` | Apple resource `79T87YT8C5` exists |
| App Group | `group.dev.shuv.shark` | Portal creation/association pending |
| Apple Services ID | `dev.shuv.shark.web` | Portal creation/configuration pending |
| Expo slug | `shark-shuv` | Operator-owned project pending |
| Production origin | `https://shark.shuv.dev` | DNS/custom domain pending |
| Production VM | `shark-prod.exe.xyz` | Running privately in PDX |

Changing any value in this table requires an explicit plan revision before continuing.

## Apple Developer portal

Complete these actions in Certificates, Identifiers & Profiles:

1. Create App Group `group.dev.shuv.shark`.
2. Edit `dev.shuv.shark` and `dev.shuv.shark.widgets`, enable App Groups, and associate that exact
   group with both. Do not add it to the notification-service extension.
3. Confirm the primary App ID retains Sign in with Apple, Push Notifications, Siri, and App Groups,
   and that the widget retains App Groups. Validate Live Activity/frequent-update and
   communication-notification entitlements against the generated project and signed artifacts
   rather than inventing unrelated portal capabilities.
4. Create Services ID `dev.shuv.shark.web`, configure Sign in with Apple against the primary App ID,
   add domain `shark.shuv.dev`, and add return URL
   `https://shark.shuv.dev/api/auth/callback/apple`.
5. Create or select a Sign in with Apple key for this service and an APNs authentication key for
   SHark delivery. Record only their key IDs outside the portal; encode each downloaded `.p8` as
   single-line base64 directly into the `SHark Production App` 1Password item. Never commit or paste key
   material into an issue, PR, log, or chat.

Apple's immutable default In-App Purchase capability on the primary ID is tolerated. Do not create
an in-app purchase, subscription, paid plan, or billing surface.

## App Store Connect

Create one internal-only iOS app record:

- Name: `SHark`
- Primary language: `English (U.S.)`
- Bundle ID: `dev.shuv.shark`
- SKU: `shark-ios`

Do not create a public TestFlight link or submit a public App Store release in v1. If App Store
Connect requires an anonymously reachable privacy or support URL before internal TestFlight can
proceed, stop and revise the plan; do not publish another anonymous surface implicitly.

## Expo/EAS

After completing the one-time `eas login` browser authorization:

1. Create an operator-owned project with slug `shark-shuv`.
2. Record its UUID as `EAS_PROJECT_ID`; the repository must never fall back to an upstream UUID.
3. Enable enhanced push security.
4. Create a server access token for Expo Push Service and store it as `EXPO_ACCESS_TOKEN` in the
   `SHark Production App` 1Password item. Do not use an
   interactive EAS session token as the server credential.
5. Import or create only operator-owned distribution, provisioning, and APNs credentials.

EAS is reserved for the final store-signed internal-TestFlight artifact. Every development or
simulator binary must be built by Sqim.

## Cloudflare and exe.dev

Create this DNS record in the authoritative `shuv.dev` zone:

- Type: `CNAME`
- Name: `shark`
- Target: `shark-prod.exe.xyz`
- Proxy status: `DNS only`
- TTL: `Auto`

After public DNS resolves, register the custom domain:

```sh
ssh exe.dev domain add shark-prod shark.shuv.dev
```

Do not make the exe.dev HTTP share public or change its selected port until the reviewed production
container is ready on loopback port `8787`. At cutover, select port `8787`, make the share public,
and verify that `/api/health` is the only anonymous content response.

## 1Password

Use two vaults so an Individual account can provide disjoint runtime access without depending on
item-level grants:

- Vault `SHark Production App`, containing exactly one Secure Note with the same title and these
  concealed fields:
  - `ALLOWED_EMAILS`
  - `BETTER_AUTH_SECRET`
  - `APPLE_SIGN_IN_KEY_ID`
  - `APPLE_TEAM_ID`
  - `APPLE_SIGN_IN_PRIVATE_KEY_BASE64`
  - `EXPO_ACCESS_TOKEN`
  - `VAPID_PUBLIC_KEY`
  - `VAPID_PRIVATE_KEY`
  - `VAPID_SUBJECT`
  - `APNS_KEY_ID`
  - `APNS_PRIVATE_KEY_BASE64`
- Vault `SHark Production Backup`, containing exactly one Secure Note with the same title and these
  concealed fields:
  - `RESTIC_REPOSITORY`
  - `RESTIC_PASSWORD`

Create two different read-only service accounts. Grant each account access only to its corresponding
vault, and provision its one-time token into the matching root-owned `/etc/shark` bootstrap file
documented in `../deploy/README.md`. Service-account vault access cannot be changed after creation,
so delete and recreate an incorrectly scoped account rather than widening its access. The helpers
fail closed unless each account sees exactly one correctly titled item with exactly its expected
field set.

Generate one production VAPID key pair with the Web Push library used by the server. Store the
base64url public and private keys in the application vault, and set `VAPID_SUBJECT` to a monitored
`mailto:` contact (or an operator-owned HTTPS URL). The public key is intentionally delivered to
authenticated browsers; the private key must never appear in client bundles, logs, screenshots, or
verification records. Rotating the pair invalidates existing browser subscriptions, so after a
rotation each browser must disable and re-enable notifications.

The legacy Bitwarden `shark` machine account, its two access tokens, the `shark` project, and all
ten migrated secrets were permanently deleted after the 1Password path passed live production
verification. The three `/etc/shark/bws-*` bootstrap files were also removed.

## rsync.net/Restic

Create a dedicated passwordless SSH key and an account-relative repository at
`repos/shark-prod`. Pin the rsync.net host key and initialize the exact SFTP repository once. The
only Restic repository-password copy lives in the `SHark Production Backup` 1Password vault and is
readable only by the backup service account.

Before enabling the nightly timer, require a real encrypted snapshot, exact byte-for-byte streamed
restore verification, `restic check`, and a disposable database restore with schema and data
checks.

## Deployment publication and promotion

exe.dev terminates SSH at its account gateway and does not expose per-key VM `authorized_keys`.
The selected replacement is a split publish/promote boundary:

1. The manual GitHub workflow runs only from `main`, verifies the source, publishes
   `ghcr.io/shuv1337/shark:<full-sha>`, and attaches build provenance to the exact digest.
2. Make that GHCR package public. It contains no secrets or private source, and public GHCR images
   can be pulled without placing a registry credential on the VM.
3. Record the full SHA and `sha256:` digest from the green workflow.
4. Through the existing operator exe.dev identity, invoke:

   ```sh
   /usr/local/sbin/shark-deploy <full-main-sha> <sha256:image-digest>
   ```

The host helper must verify repository, signer workflow, `refs/heads/main`, source SHA, hosted
runner, and digest before it materializes secrets or touches the current service. GitHub stores no
production shell credential. Do not add a self-hosted runner, deployment listener, VM bearer token,
or additional public route.
