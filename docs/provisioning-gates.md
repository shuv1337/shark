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
   single-line base64 directly into the SHark Bitwarden project. Never commit or paste key
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
   SHark Bitwarden project with a direct grant to the app machine account. Do not use an
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

## Bitwarden Secrets Manager

The dedicated project `shark` exists with UUID
`cda1aac8-67e1-498a-9d5c-b49401517ca8` and is visible to the authenticated provisioning machine
account. That identity can also see unrelated projects, so it is an administrative provisioning
identity and must not be installed on `shark-prod`. `APPLE_TEAM_ID`, `BETTER_AUTH_SECRET`,
`RESTIC_REPOSITORY`, and `RESTIC_PASSWORD` now contain real production values. The other six
required secrets remain unissued.

Create two different read-only runtime machine accounts:

- Application machine account, granted direct access only to:
  - `ALLOWED_EMAILS`
  - `BETTER_AUTH_SECRET`
  - `APPLE_SIGN_IN_KEY_ID`
  - `APPLE_TEAM_ID`
  - `APPLE_SIGN_IN_PRIVATE_KEY_BASE64`
  - `EXPO_ACCESS_TOKEN`
  - `APNS_KEY_ID`
  - `APNS_PRIVATE_KEY_BASE64`
- Backup machine account, granted direct access only to:
  - `RESTIC_REPOSITORY`
  - `RESTIC_PASSWORD`

Do not grant either machine account access to the whole project. Bitwarden supports direct
machine-account grants to selected secrets; the helpers also fail closed unless each token returns
exactly its expected key set. Provision the shared project ID and the two access tokens into the
three root-owned `/etc/shark` bootstrap files documented in `../deploy/README.md`.

Both runtime accounts currently have whole-project read access and return all four existing
secrets. After all ten secrets exist, remove that project-level assignment and make the direct
eight-key and two-key grants above. The helpers deliberately reject the current mixed view.

## rsync.net/Restic

Create a dedicated passwordless SSH key and an account-relative repository at
`repos/shark-prod`. Pin the rsync.net host key and initialize the exact SFTP repository once. The
only Restic repository-password copy lives in the SHark Bitwarden project and is readable only by
the backup machine account.

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
