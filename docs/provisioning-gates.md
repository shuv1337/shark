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
   single-line base64 directly into its eventual Bitwarden project. Never commit or paste key
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
   SHark application Bitwarden project. Do not use an interactive EAS session token as the server
   credential.
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

## Bitwarden Secrets Manager

The currently authenticated organization is at its three-project plan limit. Add capacity or use a
separate operator-controlled organization; do not reuse, rename, or delete an unrelated project.

Create two projects and two different read-only machine accounts:

- Application project:
  - `ALLOWED_EMAILS`
  - `BETTER_AUTH_SECRET`
  - `APPLE_SIGN_IN_KEY_ID`
  - `APPLE_TEAM_ID`
  - `APPLE_SIGN_IN_PRIVATE_KEY_BASE64`
  - `EXPO_ACCESS_TOKEN`
  - `APNS_KEY_ID`
  - `APNS_PRIVATE_KEY_BASE64`
- Backup project:
  - `RESTIC_REPOSITORY`
  - `RESTIC_PASSWORD`

Provision their project UUIDs and machine tokens into the four root-owned `/etc/shark` bootstrap
files documented in `../deploy/README.md`. The application and backup machine accounts must not be
able to read each other's projects.

## rsync.net/Restic

Create a dedicated passwordless SSH key and an account-relative repository at
`repos/shark-prod`. Pin the rsync.net host key and initialize the exact SFTP repository once. The
only Restic repository-password copy lives in the backup Bitwarden project.

Before enabling the nightly timer, require a real encrypted snapshot, exact byte-for-byte streamed
restore verification, `restic check`, and a disposable database restore with schema and data
checks.

## Deployment transport decision

exe.dev terminates SSH at its account gateway and does not expose per-key VM `authorized_keys`.
Therefore the originally planned VM-side forced-command SSH key is not implementable:

- Recommended: GitHub verifies/packages the exact `main` SHA and the operator invokes the host
  deployment with the existing exe.dev identity. GitHub stores no production shell credential.
- Alternative: a key tagged only to `shark-prod`, explicitly accepting that possession of the key
  grants shell access to that VM.
- Alternative: a self-hosted GitHub runner on `shark-prod`, explicitly accepting its persistent
  shell-level trust.

Do not configure a production transport until the operator selects one of these boundaries.
