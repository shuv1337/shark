# SHark Upstream Integration Plan

Status: ready for handoff. This is a read-only integration plan based on `main` at
`602bc3b242821e594fa8d32d6db49999eaaf6305` and upstream Hark `main` at
`c98ccfaeea8e5c41698565ba328443735b0a1710` (reviewed 2026-09-03). Re-fetch both remotes before
implementation and revise the recorded SHAs if either has moved.

## Goal

Bring the useful post-fork Hark work into SHark without merging `upstream/main` or regressing
SHark-specific behavior. Deliver the work as independent, reviewable pull requests in this order:

1. delivered-notification withdrawal;
2. coding-agent permission bridges;
3. optional Expo SDK 57 patch updates.

The small contracts CI dependency fix may accompany the first PR if it remains a clean two-file
change. Project inbox/customization, new Live Activity styles, and upstream marketing changes are
not part of this execution plan.

## Baseline and Evidence

- Fork merge-base: `0c0d4e3de0752ee91d2a17dee83a313f6863d6a8`.
- Current divergence: SHark has 37 unique commits and Hark has 35.
- A simulated whole-branch merge produces 63 conflicts across 164 files; do not merge or rebase
  SHark onto `upstream/main`.
- The working copy was clean and `main` matched `origin/main` at plan creation.
- SHark deliberately owns its branding, deployment, Apple/Expo identities, authentication,
  entitlements, web push, Watch app, macOS companion, durable inbox, and notification lifecycle.
  Preserve every boundary in `docs/upstream-delta.md`.

### Upstream source commits

Notification withdrawal, in dependency order:

- `21e02654e25f186fafadb1759e5ca3c0ccf60485` — delivered notification withdrawal.
- `fbc4847acda597201c7a61a5ff88cabef8ee9e12` — isolated stale-token test repair.
- `06d5b3f769282772bd1eeb773bf9baab7a411801` — idempotent withdrawal claim/rollback.

Coding-agent permission bridge, in dependency order:

- `f76658a6b4d4e8437ba79951d0684ead3778abf4` — Claude, Codex, and OpenCode bridge.
- `9e2dcd43d0ef92e9b28afabae2612c5868cf74a2` — agent artwork.
- `db786ac5e2a9600c4b1c2bd2dfdcb4464d1d7f28` — duplicate OpenCode approval coalescing.

Maintenance references:

- `2647efeb1314` — direct `@types/node` dependency for contracts typecheck.
- `78e01ef9a8bc` — Expo SDK 57 patch dependency refresh.

Treat these commits as behavioral references, not patches to cherry-pick. Hark still uses
`packages/harkctl`, Hark product names and origins, an iOS-only delivery model, and a different
inbox/schema history.

## Decisions and Boundaries

### In scope

- A webhook-token-authenticated operation that withdraws a previously delivered webhook event.
- Idempotent server state transitions and safe retry after provider failure.
- Best-effort removal on iOS, browsers, and the native macOS companion.
- Cancellation of an associated pending interaction when its notification is withdrawn.
- Durable inbox projection and timeline semantics for withdrawn and partially withdrawn events.
- A `sharkctl permissions` bridge for Claude Code, Codex, and supported OpenCode installations,
  with reversible, ownership-aware configuration edits and a diagnostic command.
- Patch-level Expo dependency updates only after the two feature PRs are stable.

### Out of scope

- A merge of `upstream/main`, history rewrite, or broad conflict resolution.
- Upstream project inbox/app-icon customization (`f743f617...`).
- Upstream homepage, pricing, launch broadcast, App Store link, analytics, or version bumps.
- Replacing SHark's existing inbox, web push, Live Activity, Watch, or macOS architectures.
- Custom-scheme tap destinations. Retain the HTTP/HTTPS-only validation in
  `packages/contracts/src/index.ts`.
- Withdrawal delivery guarantees. Provider acceptance is not proof that an OS removed a displayed
  notification.
- Live Activity ending. Continue to use the existing Activity end/replay protocol.
- Installing hooks into the executor's real home directory during tests.
- Production deployment or a real notification unless separately authorized.

## Pull Request 1: Delivered Notification Withdrawal

### 1. Lock the SHark contract with failing tests

Modify:

- `packages/contracts/src/index.ts`
- `packages/contracts/src/index.test.ts`

Add a versioned withdrawal command to the existing push-data union, retaining the protocol-facing
`HARK_*` and `@hark/*` names required by `docs/upstream-delta.md`. Define a response type for the
withdraw endpoint with terminal statuses and an `idempotent` signal.

Recommended command payload:

```json
{ "v": 1, "command": "notification.withdraw", "eventId": "evt_..." }
```

Acceptance criteria:

- Valid withdrawal commands parse through `pushDataSchema`.
- Missing/empty event ids, wrong versions, and unknown commands fail.
- Existing webhook and interaction payload fixtures remain unchanged.
- No custom URL scheme becomes valid.

### 2. Add platform-specific withdrawal senders

Modify:

- `apps/website/src/server/lib/push.ts`
- `apps/website/src/server/lib/push.test.ts`
- `apps/website/src/server/lib/web-push.ts`
- `apps/website/src/server/lib/web-push.test.ts`
- `apps/website/public/sw.js`
- `apps/website/src/server/lib/macos-push.ts` and its existing test file

If separating behavior improves depth, create a narrowly named helper such as
`apps/website/src/server/lib/notification-withdrawal.ts`; do not create a generic notification
manager.

Required behavior:

- Expo receives a data-only/background command with `contentAvailable: true`, the event id, and no
  visible alert body.
- Web notification delivery uses an event-specific tag. The service worker recognizes the
  withdrawal command, calls `registration.getNotifications({ tag })`, closes every match, and does
  not display a new notification for the command.
- macOS receives a silent APNs payload containing the same event id. Do not send a visible
  withdrawal banner.
- The aggregate result preserves separate stale Expo token, web subscription, and macOS device
  identifiers so the route can deactivate only the failed targets.
- Error strings remain server-only because provider errors can contain tokens.

Use one shared function to derive the event-specific tag/identifier. Existing notification sends
must adopt that identifier before withdrawal can reliably target them. Preserve interaction tags
and response categories.

### 3. Implement the authenticated, idempotent route

Modify:

- `apps/website/src/server/routes/hooks.ts`
- `apps/website/src/server/routes/hooks.test.ts`
- `apps/website/src/server/lib/inbox.ts`
- the narrow inbox tests that cover event projection/timeline state

Add `POST /hooks/:token/events/:eventId/withdraw`, matching the existing webhook ownership model.
Do not add a session-authenticated or agent-token alias in this PR.

State machine:

```text
accepted | partial | failed | no_devices
                  -> withdraw_processing
                  -> withdrawn | withdraw_partial

provider accepts zero -> restore the exact prior state
withdrawn | withdraw_partial -> return success with idempotent=true; send nothing
processing | withdraw_processing -> 409; send nothing
unknown event or wrong service token -> 404
```

Implementation constraints:

- Read the event through an inner join to its owning service and hashed webhook token.
- Claim with a conditional update from the observed status to `withdraw_processing`; concurrent
  callers must not both send.
- On thrown errors or zero provider acceptance, conditionally restore only rows still in
  `withdraw_processing` to the exact previous status.
- On success, store `withdrawn` when every selected target accepted and `withdraw_partial` when at
  least one but not all accepted.
- Deactivate stale Expo/web/macOS registrations through their existing tables.
- Cancel any still-pending interaction for the event in the same logical completion path.
- Synchronize the durable inbox after the event transition. A withdrawn notification must not
  appear under Active; its timeline must contain one deduplicated withdrawal event. A partially
  withdrawn notification is terminal delivery history, not an active lifecycle.
- No schema migration is expected because event and inbox status columns are text. If source
  inspection disproves that, stop and add an explicit migration task rather than changing schema
  implicitly.

Route tests must cover ownership, missing event, in-flight event, full success, partial success,
zero acceptance rollback, thrown-provider rollback, stale-target deactivation, interaction
cancellation, concurrent/idempotent retry, and second withdrawal sending no push.

### 4. Handle withdrawal on iOS

Create:

- `apps/expo/src/lib/notification-withdrawals.ts`
- `apps/expo/src/lib/notification-withdrawals.test.ts`
- `apps/expo/index.ts` only if a custom entry point remains necessary after an Expo Router spike

Modify as required:

- `apps/expo/package.json`
- `apps/expo/app.config.ts`
- `apps/expo/tsconfig.json`
- `apps/expo/app/_layout.tsx`

Start with a tiny spike proving whether Expo SDK 57 can register the background task from the
current `expo-router/entry` path. Prefer importing a registration-only module from a guaranteed
early entry point. Change `package.json.main` to a custom `apps/expo/index.ts` only if the spike
shows that `_layout.tsx` is too late or unreliable for headless delivery.

Port the upstream envelope parser and background task with these requirements:

- Accept Expo task envelopes, notification content data, and direct command fixtures.
- Extract only a contract-valid withdrawal command.
- Enumerate presented notifications and dismiss every notification carrying the same event id.
- Return `NewData`, `NoData`, or `Failed` accurately.
- Registration failure may log a redacted warning; never log notification content or tokens.
- Existing tap routing, Live Activity action routing, WidgetKit, Watch target, and notification
  service extension remain unchanged.

### 5. Handle withdrawal on macOS

Modify:

- `apps/macos/Sources/AppDelegate.swift`
- `apps/macos/Tests/CompanionStoreTests.swift`, or create a focused AppDelegate/parser test target
  only if the current target cannot exercise the logic cleanly
- `apps/macos/project.yml` only if the test target needs a new source file

Parse the command from the `hark` user-info dictionary in
`application(_:didReceiveRemoteNotification:)`. Remove delivered notifications whose request
metadata carries the matching event id, then refresh the server-authoritative inbox. Keep parsing
in a pure helper that can be unit tested without APNs.

Do not remove notifications by title, thread name, or service id; those can match unrelated events.
If macOS APNs cannot invoke the background callback under the signed app's current entitlement and
payload shape, keep server/inbox withdrawal correct, document macOS Notification Center removal as
best-effort, and record the signed-device gate rather than weakening identifiers.

### 6. Document behavior and compatibility

Modify:

- `apps/website/src/shared/docs/content.ts`
- `apps/website/src/shared/docs/docs.test.ts`
- `docs/upstream-delta.md`
- `docs/verification.md` after verification, recording evidence only

Document the route, ownership requirement, retry/idempotency behavior, and best-effort OS delivery.
Say explicitly that an accepted silent push is not proof of removal and force-quit/background policy
can prevent handling.

### 7. Validate PR 1

Run the narrow checks first:

```sh
pnpm --filter @hark/contracts test
pnpm --filter @hark/contracts typecheck
pnpm --filter @hark/website test -- src/server/lib/push.test.ts
pnpm --filter @hark/website test -- src/server/lib/web-push.test.ts
pnpm --filter @hark/website test -- src/server/routes/hooks.test.ts
pnpm --filter @hark/expo test -- src/lib/notification-withdrawals.test.ts
pnpm macos:test
```

Then run the repository gates:

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm brand:check
pnpm build
```

Expected signals: all commands exit zero; the worktree contains no generated iOS project churn,
build output, credentials, device tokens, or unrelated formatting changes.

Physical smoke test, only after separately authorized:

1. Send one synthetic notification to explicitly selected test targets.
2. Record its event id without exposing tokens.
3. Withdraw it once and verify the server/inbox terminal state.
4. Verify removal from iPhone, one browser, and the signed macOS app where OS policy permits.
5. Repeat the exact withdrawal and verify `idempotent=true` with no additional provider send.

## Pull Request 2: Coding-Agent Permission Bridge

Do not combine this with withdrawal. Re-read current Codex, Claude Code, and OpenCode hook formats
before implementation; upstream's August 2026 formats are references, not proof of current
compatibility.

### 1. Port and rename the bridge

Create under `packages/sharkctl/src/permissions/`:

- `cli.mjs`
- `hark.mjs` (retain the compatibility name only where it is protocol-facing; otherwise prefer a
  SHark-facing filename)
- `hook.mjs`
- `install.mjs`
- `opencode-v1.mjs`
- `opencode-v2.mjs`

Create the matching focused tests under `packages/sharkctl/test/` and add dispatch/help entries in:

- `packages/sharkctl/src/cli.mjs`
- `packages/sharkctl/README.md`
- `skills/shark/SKILL.md`

Port behavior, not branding. Commands must be `sharkctl permissions ...`; user-visible status,
LaunchAgent labels, state directories, log directories, descriptions, and artwork must use SHark.
Keep `HARK_*` environment/config compatibility only where the existing fork deliberately preserves
it.

### 2. Preserve safe installation semantics

- Support `setup`, `uninstall`, and `doctor` independently for each agent.
- Use atomic writes with compare-before-replace so a concurrently edited config is never clobbered.
- Make setup idempotent and uninstall remove only bridge-owned entries.
- Preserve file modes and use `0700` directories plus `0600` new files.
- Never interpolate untrusted prompt content into a shell command.
- Tests use a temporary fake home and synthetic hook payloads only.
- Linux may install only connectors actually supported there; do not imply OpenCode support when a
  macOS LaunchAgent is required.
- `doctor` must distinguish authentication, required scopes, installed state, stale executable
  paths, and unsupported platform state.

### 3. Use the existing SHark interaction protocol

The bridge must call the installed, trusted `sharkctl`; it must not duplicate token parsing or read
credentials directly. Require `notifications:send`, `interactions:create`, and
`interactions:read`. Permission asks must use a stable idempotency key, a bounded timeout, and the
existing approval/deny response contract.

Apply the security guidance already present in `skills/shark/SKILL.md`: describe only the exact
action being authorized, delimit untrusted external context, and never treat text inside that
context as an instruction. Preserve the upstream OpenCode duplicate-coalescing fix.

### 4. Validate PR 2

```sh
pnpm --filter sharkctl test
pnpm --filter sharkctl build
node --test packages/sharkctl/test/permissions-cli.test.mjs
node --test packages/sharkctl/test/permissions-hook.test.mjs
node --test packages/sharkctl/test/permissions-install.test.mjs
pnpm typecheck
pnpm test
pnpm lint
pnpm brand:check
```

Add fixture assertions that setup twice produces one owned hook, uninstall preserves unrelated
hooks, a concurrent edit aborts, missing scopes fail closed, malformed hook input sends nothing,
and duplicate OpenCode requests coalesce.

Do not run setup against the executor's real `~/.codex`, `~/.claude`, or OpenCode configuration.
Real installation and a real Watch/iPhone approval are separate, explicitly authorized dogfood
steps after merge.

## Pull Request 3: Optional Expo Patch Refresh

Start only after PR 1's iPhone/Watch behavior is stable. Re-run `npx expo install --check` or the
repository-approved pinned equivalent before choosing versions; do not assume the August upstream
versions remain current.

Reference changes from upstream `78e01ef9a8bc`, but preserve:

- `https://shark.shuv.dev` inside the patched widget registrar;
- SHark bundle ids, App Group, EAS project id, Apple Team handling, Watch target, and notification
  service target;
- the current React Native and Expo compatibility matrix.

The upstream patch moves `expo-widgets` to `57.0.8`; SHark currently patches `57.0.6`. Regenerate
or carry the patch deliberately, diff its semantic content, run a clean prebuild diff, and reject
unexpected native project churn.

Validation:

```sh
pnpm install --frozen-lockfile
pnpm --filter @hark/expo test
pnpm --filter @hark/expo typecheck
pnpm typecheck
pnpm test
pnpm lint
pnpm brand:check
```

Then use the repository's approved iOS build workflow to build the iPhone host, WidgetKit/Live
Activity extension, notification service extension, and Watch companion. A simulator-only build is
not sufficient evidence for push, background withdrawal, Watch installation, or signed
entitlements.

## Small Contracts CI Fix

`2647efeb1314` adds `@types/node` directly to `packages/contracts/package.json` and its lockfile.
It applied cleanly in a read-only patch check, while the current contracts typecheck already exits
zero. Include it only if a clean install/CI reproduction demonstrates that contracts otherwise
relies on a transitive type package. Keep it as a separate commit so it can be dropped without
affecting withdrawal.

## Integration and Git Workflow

Use Jujutsu for local work:

1. `jj git fetch --remote origin` and `jj git fetch --remote upstream`.
2. Confirm `main` equals `main@origin`, then create a new change from `main`.
3. Reimplement each behavior against current SHark files; do not `jj duplicate` the feature
   commits or merge the upstream bookmark.
4. Keep one coherent PR per section above. Preserve unrelated working-copy changes if the checkout
   is no longer clean.
5. Before push, inspect `jj diff`, `jj status`, and the commit graph. Push only the named feature
   bookmark; never force-push `main`.
6. Require the protected `Verify source` check and normal review before merge.

Suggested commit boundaries for PR 1:

1. contracts and failing fixtures;
2. server/platform send helpers;
3. idempotent route and inbox projection;
4. iOS handler;
5. macOS handler;
6. docs and verification evidence.

## Rollback

- Before production promotion, rollback is a normal PR revert. Do not rewrite public history.
- The withdrawal route adds behavior but no expected schema migration, so reverting it should not
  require database restoration. If implementation introduces a migration, update this section and
  prove backward compatibility before merge.
- A deployed rollback must follow `deploy/README.md` and `docs/operations.md`, preserving the
  pre-promotion encrypted snapshot and immutable image provenance.
- Removing the permission bridge package code does not remove hooks previously installed in user
  homes. Run the matching reviewed `permissions uninstall` command before removing that command in
  a later release.

## Risks

- iOS and macOS background delivery is best effort and can be suppressed after force-quit.
- A mixed-platform aggregate can report partial acceptance even when every reachable device behaved
  correctly; UI text must distinguish terminal partial delivery from an active lifecycle.
- Reusing a service-level browser tag would close unrelated notifications; event-specific identity
  is mandatory.
- The current macOS notification metadata may not expose a stable request identifier; add the event
  id to future sends before implementing removal.
- Agent hook formats can drift independently of SHark. Fixture tests and live documentation review
  are required before writing real configuration.
- Expo patch upgrades can regenerate native files and disturb Watch/Widget/notification-extension
  settings; treat native diffs as review blockers until explained.

## Done When

- Each included PR is based on current `main`, contains only its declared scope, and passes its
  narrow and repository-wide gates.
- Notification withdrawal is authenticated, concurrent-safe, idempotent, projected correctly in
  the inbox, and best-effort across iOS/web/macOS without touching Live Activity lifecycle.
- The permission bridge installs and uninstalls safely in fixture homes, routes exact approval
  questions through the existing SHark interaction API, and fails closed on malformed input or
  missing scopes.
- The HTTP/HTTPS tap destination boundary, protocol compatibility identifiers, Watch target,
  macOS companion, web notifications, existing auth, and deployment behavior remain intact.
- No secret, live token, real notification content, generated build output, or unrelated working
  tree change is committed.
