# SHark Pre-Implementation Grilling Handoff

## Purpose

The pre-implementation grilling session is complete. The user confirmed shared
understanding for the frozen decisions below. Do not begin implementation,
credential creation, VM creation, builds, or deployment without a separate
explicit request.

The implementation plan is:

- `/Users/shuv/repos/shark/PLAN-shark-minimal-rebrand-self-host.md`

The plan was revised after a primary review, an independent Pi Opus review, and
Pi Fable adjudication. It and this handoff are tracked; the current working tree
contains the requested follow-up revisions relative to SHark repository HEAD
`e72dbd6a5ff81adb3964bb6390c6a181d2eeea5c`. Do not duplicate the plan in this
handoff; read it in full before continuing.

## Important State Warning

The settled decisions below and the Build iOS Apps review recommendations have
now been written into the plan:

- Authentication is Apple-only, so all Google OAuth configuration, UI, tests,
  documentation, and startup requirements are removed from the implementation
  scope.
- Apple admission will use the exact verified email Apple returns, including an
  Apple relay address when that is the account's address. The plan now reflects
  this rather than the earlier “Share My Email required / relay denied” policy.
- The deployment section is specialized for exe.dev, Cloudflare DNS-only,
  rsync.net, Restic, and Bitwarden Secrets Manager.
- All test builds must use Sqim.

Grilling is complete and the user confirmed the resulting shared understanding.
The plan and this handoff now serve as the implementation contract.

## Settled Decisions

### Product identity and authentication

- First-release authentication: **Apple only**.
- Admission key: **the exact verified Apple email**, accepting either the real
  email or the Apple private relay email returned for SHark.
- There is no cross-provider linking problem because Google is out of scope.
- Allowlist enforcement: **on every credential-bearing request**, including
  browser sessions, CLI/API tokens, webhook URLs, interaction callbacks, and
  Live Activity credentials.
- Persisted-credential cleanup remains defense in depth through a documented or
  transactional offboarding operation.
- Frozen identifiers:
  - Production origin: `https://shark.shuv.dev`
  - App bundle ID: `dev.shuv.shark`
  - Widget bundle ID: `dev.shuv.shark.widgets`
  - Notification-service bundle ID:
    `dev.shuv.shark.notification-service`
  - App Group: `group.dev.shuv.shark`
  - URL scheme: `shark`
- Apple Developer Program membership is active.
- First mobile distribution boundary: **internal TestFlight only**.
- Expo/EAS project owner: **personal operator account**.

### Push architecture

- Preserve the existing transport split:
  - Expo Push Service for ordinary notifications.
  - Direct APNs for Live Activity start/update/end.

### Production hosting and deployment

- Provider: **exe.dev**.
- Create a **new isolated VM** for SHark.
- Keep the exe.dev account's existing **PDX** region policy.
- Initial VM allocation: **2 vCPU, 4 GB RAM, 25 GB disk**.
- HTTPS termination: **exe.dev managed proxy**.
- Cloudflare mode for `shark.shuv.dev`: **DNS-only**, with a CNAME to the VM's
  `*.exe.xyz` hostname and explicit exe.dev custom-domain registration.
- The exe.dev HTTP share must be public because OAuth callbacks, webhooks, and
  the app API need unauthenticated network reachability before SHark auth.
- Leave `TRUSTED_CLIENT_IP_HEADER` unset for the first release.
  - exe.dev appends the edge-observed client IP to any incoming
    `X-Forwarded-For`.
  - Hark currently reads the first value, which would be spoofable.
  - Account/service rate limits remain active without a trusted IP header.
- Deployment initiator: **manual-dispatch GitHub Actions workflow over SSH**.
- VM name: **`shark-prod`**.
- Deploy directory: **`/home/exedev/shark`**.
- GitHub deploy authentication: a dedicated `shark-prod`-only forced-command
  SSH key with shell, PTY, agent forwarding, and port forwarding disabled;
  rotate every 90 days.
- `shark-prod` fetches its own scoped application secrets from Bitwarden.
  GitHub stores only the deploy key and pinned host-verification material.
- Immutable images: retain full-Git-SHA tags **on the production host**, record
  image digests, and keep enough tags for rollback.

### Backups and secrets

- Off-host backup destination: **rsync.net**.
- Backup tool: **Restic over SFTP**.
- Restic provides encryption, repository checks, snapshots, retention, and
  restore support.
- Secret source of truth: **Bitwarden**.
- Machine access: **Bitwarden Secrets Manager** with scoped projects/machine
  accounts, not a personal-vault CLI session.
- GitHub and the production VM receive only the values they need.
- Restic repository suffix: **`repos/shark-prod`**.
- Backup cadence: nightly at **2:00 AM America/Los_Angeles** plus one verified
  pre-deploy snapshot.
- Retention: **7 daily / 4 weekly / 6 monthly**.
- The only Restic repository password copy is in Bitwarden; there is no offline
  or second-vault copy.
- Repository verification is a **quarterly restore drill only**. Do not add
  weekly or monthly check jobs in v1.

### iOS build and test workflow

- Use the **Build iOS Apps plugin** and its XcodeBuildMCP practices.
- Use **Sqim (`sqim.dev`) for every test build**.
- XcodeBuildMCP never compiles a test binary. It may install, launch, inspect,
  automate, screenshot, and capture logs from Sqim-produced simulator
  artifacts.
- EAS builds only the final store-signed artifact submitted to internal
  TestFlight.
- Delete superseded Sqim artifacts when supported and retain none longer than
  30 days; keep only hashes and verification records afterward.
- Sqim's current documented Mac setup is:

  ```bash
  brew install milq-ai/tap/sqim
  sqim setup all
  sqim login
  ```

- The current Mac has Sqim 0.2.4 and the Sqim skill installed. `sqim status`
  reports an existing login whose access token is expired but refreshable.
  Recheck status immediately before build work; do not repeat installation
  unless that current check fails.
- Sqim publishes signed device builds through hosted install pages and can share
  simulator builds. Its dashboard retains project/build access.
- Internal TestFlight is the release-distribution boundary.

## Verified Facts

- The reviewed upstream code baseline is
  `0c0d4e3de0752ee91d2a17dee83a313f6863d6a8`. Current local and `origin/main`
  point to `e72dbd6`, whose only changes from that baseline are this plan and
  handoff; `upstream/main` remains at the baseline.
- The exe.dev account reports region `pdx` / Oregon.
- exe.dev provides persistent Linux VMs, managed HTTPS, custom domains, and an
  SSH API.
- exe.dev custom domains require:
  1. a DNS CNAME to `<vm>.exe.xyz`,
  2. DNS-only mode when Cloudflare is authoritative,
  3. `ssh exe.dev domain add <vm> shark.shuv.dev`.
- exe.dev proxies to one selected public port and supplies
  `X-Forwarded-Proto`, `X-Forwarded-Host`, and appended
  `X-Forwarded-For`.
- `shuv.dev` currently uses Cloudflare nameservers.
- The Build iOS Apps debugger workflow prefers XcodeBuildMCP for simulator
  defaults, build/run control, UI descriptions/screenshots, and log capture.

Relevant current documentation:

- exe.dev proxy: <https://exe.dev/docs/proxy>
- exe.dev custom domains: <https://exe.dev/docs/cnames>
- exe.dev regions: <https://exe.dev/docs/regions>
- Sqim: <https://www.sqim.dev/>
- Expo simulator builds:
  <https://docs.expo.dev/build-reference/simulators/>

## Completed Grilling Decisions

- Self-host limits: **300 requests/minute per service** and **1,500 per
  account**.
- No proactive production alerts in v1. The operator performs documented manual
  health, deployment, backup, disk, and restart checks.
- Keep capped, redacted logs locally for seven days; do not add centralized
  logging.
- Allowlist removal disables access and revokes every credential class but
  preserves user data. Permanent deletion is a separate explicit operation.
- Health checks are the only anonymous content surface. Human-facing pages
  require Apple authentication. OAuth callbacks and credential-bearing protocol
  endpoints remain network-reachable but are not anonymous content.
- Internal TestFlight acceptance uses one allowlisted operator account on two
  physical iPhones.
- Recover the exact historical Devil Phone SVG and safe-area raster from an
  operator-controlled source and require the recorded hashes to match.
- Remove paid-plan UI, Autumn runtime/configuration, Google OAuth, public
  TestFlight, and public App Store scope from v1 rather than merely hiding or
  leaving them unconfigured.

## Build iOS Apps Best-Practice Constraint

Before the first XcodeBuildMCP runtime/test call in the next session:

1. Call `session_show_defaults`.
2. Discover/select the correct project or workspace, scheme, and simulator only
   if defaults are missing or wrong.
3. Do not invoke an XcodeBuildMCP command that compiles a binary.
4. After launching an artifact, verify it with the UI description or screenshot
   before interaction.
5. Capture app logs around failures and summarize only relevant lines.
6. Prefer semantic UI targets over coordinates.
7. Keep real-device acceptance for push notifications, notification actions,
   APNs Live Activities, Dynamic Island, and device-token behavior.

## Suggested Skills for Implementation

- `sqim` — produce every simulator and development-device test build.
- `build-ios-apps:ios-debugger-agent` — XcodeBuildMCP simulator inspection,
  interaction, and debugging of an already-built Sqim artifact.
- `build-ios-apps:ios-simulator-browser` — only if a simulator must be mirrored
  into the in-app browser.
- `build-ios-apps:swiftui-ui-patterns` — when implementing or reviewing the
  generated SwiftUI widget and Live Activity surfaces. The main client remains
  Expo/React Native.
- `build-ios-apps:swiftui-view-refactor` — only if those SwiftUI surfaces need
  structural refactoring.

## Implementation Handoff

Read this handoff and the full plan before acting. Grilling is closed and the
decision record is frozen. A future implementation request should execute the
plan in milestone order, preserve unrelated work, and verify each exit criterion
with current evidence. Any newly discovered conflict with a frozen decision is
a stop-and-return condition rather than permission to improvise.
