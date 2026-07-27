# SHark Pre-Implementation Grilling Handoff

## Purpose

Continue the pre-implementation grilling session on the Mac/iOS development
environment. Do not implement SHark until the remaining questions have been
asked one at a time and the user confirms shared understanding.

The implementation plan is:

- `/home/shuv/repos/hark/PLAN-shark-minimal-rebrand-self-host.md`

The plan was revised after a primary review, an independent Pi Opus review, and
Pi Fable adjudication. It is currently untracked. Do not duplicate the plan in
this handoff; read it in full before continuing.

## Important State Warning

The grilling decisions below have **not yet been written back to the plan**.
Some now supersede plan text:

- Authentication is Apple-only, so all Google OAuth configuration, UI, tests,
  documentation, and startup requirements must be removed from the plan.
- Apple admission will use the exact verified email Apple returns, including an
  Apple relay address when that is the account's address. This supersedes the
  plan's current “Share My Email required / relay denied” policy.
- The generic deployment section must be specialized for exe.dev, Cloudflare
  DNS-only, rsync.net, Restic, and Bitwarden Secrets Manager.
- All test builds must use Sqim.

Do not update the plan until grilling is complete and the user confirms the
resulting shared understanding.

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

### iOS build and test workflow

- Use the **Build iOS Apps plugin** and its XcodeBuildMCP practices.
- Use **Sqim (`sqim.dev`) for every test build**.
- Sqim's current documented Mac setup is:

  ```bash
  brew install milq-ai/tap/sqim
  sqim setup all
  sqim login
  ```

- The Linux environment used for this grilling session had neither the `sqim`
  executable nor a Sqim skill installed. Perform setup only on the intended Mac
  after reviewing the installer and generated skill.
- Sqim publishes signed device builds through hosted install pages and can share
  simulator builds. Its dashboard retains project/build access.
- Internal TestFlight remains the release-distribution boundary; clarify how
  Sqim test artifacts and the final EAS/TestFlight artifact divide responsibility.

## Verified Facts

- Current repo baseline and remote heads were verified during plan review at
  `0c0d4e3de0752ee91d2a17dee83a313f6863d6a8`.
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

## Interrupted Question

The last unanswered grilling question was:

> What per-minute limits should self-host mode use initially?

Recommended answer:

- **300 requests/minute per service**
- **1,500 requests/minute per account**

These reuse the current Pro defaults and minimize code/test churn. The user did
not answer because the turn was interrupted by the Sqim/Build iOS Apps
instruction.

Ask this question again with the ask-questions tool before proceeding.

## Remaining Grilling Branches

Ask one question at a time, provide a recommendation, and wait for the answer.
At minimum resolve:

1. Self-host per-service and per-account rate limits.
2. Exact Sqim boundary:
   - Does “all test builds” prohibit XcodeBuildMCP from compiling local
     simulator diagnostics?
   - May XcodeBuildMCP install/run/inspect a Sqim-produced simulator artifact?
   - Is EAS used only for the final internal-TestFlight build?
3. Sqim setup/authentication and whether build artifacts need an explicit
   retention/deletion policy.
4. Exact exe.dev VM name and deploy directory.
5. GitHub Actions authentication to exe.dev:
   use a VM-scoped, command-limited, expiring exe.dev API/SSH key where
   possible.
6. Whether GitHub reads deploy secrets directly from Bitwarden Secrets Manager
   at runtime or Bitwarden synchronizes selected GitHub environment secrets.
7. Restic repository path, backup cadence, and whether the plan's proposed
   retention remains `7 daily / 4 weekly / 6 monthly`.
8. Restic password/key recovery and repository-check cadence.
9. Production monitoring and alert destination.
10. Log retention and redaction policy.
11. Whether account offboarding deletes user data or only disables access and
    revokes credentials.
12. Whether the public marketing/docs pages remain public while the dashboard
    and API use Apple auth.
13. Whether internal TestFlight needs more than one operator device/account.
14. Final source of the app icon ownership/provenance statement.
15. Final confirmation that paid-plan UI, Autumn, Google OAuth, and public App
    Store scope are removed rather than merely hidden or left unconfigured.

Continue exploring repository facts instead of asking the user questions that
the code can answer.

## Build iOS Apps Best-Practice Constraint

Before the first XcodeBuildMCP build/run/test call in the next session:

1. Call `session_show_defaults`.
2. Discover/select the correct project or workspace, scheme, and simulator only
   if defaults are missing or wrong.
3. Respect the user's Sqim-only test-build rule before invoking any command that
   compiles a binary.
4. After launching an artifact, verify it with the UI description or screenshot
   before interaction.
5. Capture app logs around failures and summarize only relevant lines.
6. Prefer semantic UI targets over coordinates.
7. Keep real-device acceptance for push notifications, notification actions,
   APNs Live Activities, Dynamic Island, and device-token behavior.

## Suggested Skills

- `grill-me` / `grilling` — resume the one-question-at-a-time interview.
- `build-ios-apps:ios-debugger-agent` — XcodeBuildMCP simulator/build/debug
  workflow, subject to the Sqim-only build boundary.
- `build-ios-apps:ios-simulator-browser` — only if a simulator must be mirrored
  into the in-app browser.
- `build-ios-apps:swiftui-ui-patterns` — when implementing or reviewing SwiftUI
  presentation changes.
- `build-ios-apps:swiftui-view-refactor` — only if the rebrand requires
  structural SwiftUI refactoring.
- `lazy-plan-reviewer` — re-review the final revised plan after grilling answers
  are written back.
- `no-mistakes` — validate implementation changes before delivery.
- `oxmgr` is not relevant to the selected exe.dev Docker Compose deployment
  unless process supervision changes later.

## Resume Instruction

Start by reading this handoff and the full plan. Re-run the interrupted rate
limit question through the ask-questions tool. Continue grilling until every
remaining branch is resolved. Then summarize the decisions, ask the user to
confirm shared understanding, and only after confirmation update the plan for
implementation.
