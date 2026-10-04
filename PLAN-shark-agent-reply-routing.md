# SHark Agent Reply Routing Plan

Updated: **2026-09-08**. Status: **staged shuvcode broker implemented; SSHuv release gates open**.
The original 2026-08-20 plan was added in `24d3f69` (#32). Phase 1 landed in `13e944f` (#33);
the approved staged shuvcode broker now exists in the isolated implementation workspace. Automatic
lifecycle collection and the other required native adapters remain unimplemented. The SSHuv
requirements below are confirmed product requirements, not completed features.
Admission, existing-session access, cross-surface arbitration, and iOS handoff still require proof
before their implementation contracts can be finalized. This is not blanket readiness to implement.

This refresh preserves the original deferred-reply reliability design, corrects its status and
expiry guidance, and adds the SHark-side work and cross-repository gates needed by SSHuv.
The SSHuv sections supersede the old one-adapter release order and any implication that SHark is
the only user-input surface. Unresolved choices are explicit gates, not implicit scope reductions.

### Implementation progress, 2026-09-08

The subsequent user request authorizes implementation of this plan. It supersedes the historical
plan-edit-only authorization recorded at the end of this document. Work is isolated in the
`agent-reply-routing-20260907` Jujutsu workspace; unrelated primary-checkout edits are preserved.

**Sequencing decision, 2026-09-08:** the user approved proceeding with the shuvcode-only reference
broker after the installed-runtime/SHark proof. This supersedes the requirement to close Codex and
Claude admission before creating the initial broker package/store. Their unsupported capabilities
must fail closed. All three native agents, shared response arbitration, Herdr, and signed SSHuv
handoff remain mandatory for the final release. The initial local API is versioned and limited to
the proven shuvcode operations; it is not a claim that the common three-agent contract is final.

- [x] Reverify Phase 1 source behavior and preserve the existing CLI contract.
- [x] Inventory standard permission-hook and service locations on `shuvbot` and `shuvdev`
  read-only; preserve existing non-SHark hooks. Effective-session inventory and migration remain open.
- [x] Prepare a pure completion-content reference prototype with real-contract boundary fixtures;
  it is not exported or integrated into a command. Phase 4 runtime integration remains open.
- [x] Extract `sharkctl/client`, export the supported package subpaths, add protected file-only
  configuration and notification/interaction helpers, and document the packaging change. The
  independent extraction does not select an agent adapter or create broker storage.
- [x] Implement the independently testable Phase 5 **candidate**: strict configured HTTPS prefix,
  default-tap forwarding, existing detail fallback and action queue, and cold/listener callback
  deduplication. Forwarding remains disabled without an operator-selected prefix. This does not
  close the signed SSHuv handoff gate. See [candidate notes](docs/agent-reply-routing/ios-handoff.md).
- [x] Build and test the shuvcode runtime candidate: opt-in session event retention, durable
  question/permission receipts, exact reply retries, first-answer atomicity, and native TUI/HTTP
  cooperation. Source, compiled-binary, and forced-restart results are recorded in the
  [runtime candidate report](docs/agent-reply-routing/research/opencode-v2/runtime-candidate.md).
  The user subsequently merged and deployed PR #364. The Mac artifact and elected service were
  verified on 2026-09-08; effective event retention, other-host activation, and Herdr acceptance
  remain open. No installed service was replaced by this implementation task.
- [x] Prove SHark/shuvcode active-response arbitration and deferred queued execution against
  the deployed Mac artifact: 11 integration cases and 21 prototype tests cover response loss,
  restart, native desktop-first precedence, SHark cancellation races, and exact input replay.
  See the [arbitration proof](docs/agent-reply-routing/arbitration-prototype/README.md).
  This is a research seam without a broker store; it does not close the three-agent release gate.
- [x] Implement the approved staged shuvcode-only broker: protected WAL outbox, exact creation/reply
  recovery, active native arbitration, completion CLI, local API v1, queue controls, daemon, and
  portable systemd/LaunchAgent lifecycle fixtures. See [broker documentation](packages/shark-broker/README.md).
  Installed-runtime tests include seven actual broker SIGKILL boundaries and concurrent creation;
  service activation, event collection, and other-agent support are not implied.
- [ ] Close all three native-session, admission, restart/replay, and arbitration research gates.
  Installed-runtime probes have found material gaps; see the
  [implementation evidence ledger](docs/agent-reply-routing/README.md).
- [ ] Extend the staged local seam to the proven common contract, add native lifecycle/cursor
  collection and destination mappings, and complete all three production adapters after their gates close.
- [ ] Complete the SSHuv-owned app/host integration, choose the HTTPS origin and enrollment policy,
  and pass signed shuvtest-phone acceptance.
- [ ] Install reviewed artifacts on participating hosts and complete operational acceptance.

The staged broker package and shuvcode adapter are source implementations, not activated host services.
No deployment, live notification, or existing user-session input was performed. Disposable local
harness probes are recorded separately
from production and physical-device acceptance. The original three-agent and delivery requirements
remain in force; the research results are not permission to weaken them.

## Goal

Make SHark the default path for agent questions that need a user response:

- Blocking questions should use SHark's existing free-text interaction and return the reply to the
  active agent turn.
- A completed turn with an actionable follow-up question should send one combined done-and-question
  notification with a reply field.
- A reply to a completed turn should start a new turn in the originating session without keeping the
  original agent process blocked.

Also make SHark the notification and deferred-reply substrate for **SSHuv**, the user's personal
iOS terminal and native coding-agent app. Reuse existing SHark delivery, registered devices, and
durable inbox instead of building a second push backend.

The baseline design preserves existing SHark server contracts and keeps harness orchestration on
the agent hosts (see `AGENTS.md`, `docs/upstream-delta.md`). A narrowly scoped SHark iOS tap-routing
change is required. If the integration spikes prove a server contract change unavoidable, record
the exact gap, migration, compatibility cost, and user decision before implementing it; do not
silently relax the SSHuv requirements or add harness-aware server state.

## Confirmed SSHuv v1 Requirements

Confirmed by the user during SSHuv's Wayfinder interview on 2026-09-07:

- Personal use only for now; public onboarding, teams, and billing are outside this milestone.
- First-class Herdr integration, including functional terminal passthrough, alongside a native
  agent experience. Herdr pane identity is not agent conversation identity. Merely launching the
  Herdr TUI over SSH is not proof of the requested passthrough behavior.
- **All three** agents ship in the first release: **OpenCode v2 only**, **Codex app-server**, and
  **Claude CLI**. OpenCode v1 compatibility is not required; Codex CLI hooks do not satisfy the
  app-server target. Each needs native conversations, tool output, prompting, questions, and
  approvals, not just notifications or terminal access.
- Discover and continue conversations started in desktop Herdr without requiring SSHuv to have
  launched them. One-time trusted host setup may be needed, but a phone-launch-only implementation
  is not an acceptable substitute. Safe live access and inactive-session resume require separate
  per-agent proof.
- Notify on **needs input, completion, and failure**, including while another app is open or the
  phone is locked. A normal notification tap must open the **exact SSHuv conversation**. An
  intermediate SHark inbox screen followed by an Open link button does not meet this requirement.
- **SHark-branded notifications are acceptable for v1**. They belong to the SHark app identity;
  renaming a notification title does not make them SSHuv-native push notifications.
- User-controlled hosts and backend infrastructure. Existing Apple/Expo push delivery remains an
  external dependency; self-hosting is not a promise of an entirely local iOS push transport.
- Moshi is the workflow reference and SSHHIP's CommandDial is a UI reference. Moshi hooks may be
  reused only after source, license, and target-version compatibility are verified. Neither UI
  reference adds a SHark server feature or establishes a working agent adapter.

This plan owns SHark changes and the integration requirements SSHuv must consume. SSHuv's full
navigation, CommandDial, terminal renderer, attachments/review scope, minimum iOS version, and
distribution choices stay in SSHuv planning. They are not decided by this document.

## Implementation Baseline and Evidence Boundary

Initial source inspection: `153461408fe6ff0fdf99fc7fd9ee5284514db2db`. Before publication,
`origin/main` advanced to `faf3d9e4`, adding Node types for contracts (#43) and bounded push previews
(#44). The latter improves provider payload sizing while retaining durable inbox content; it does
not implement agent adapters or one-tap SSHuv routing. The refreshed plan is based on that current
main revision. Separately committed `PLAN-upstream-integration.md` work is outside this change and
must not be included in this plan-only main publication.

| Component | Verified baseline on 2026-09-07 | Remaining gate |
| --- | --- | --- |
| Phase 1 blocking expiry | Implemented with source tests in #33, including flag/stdin precedence and Live Activity clamps | Verify/install the reviewed CLI artifact on each participating host |
| This Mac's installed `sharkctl` | Reports package version `0.4.1` but still has the old 15-minute default without timeout-derived expiry | Package version alone is insufficient; verify behavior or artifact identity |
| Phase 2 broker and admission proof | No recorded successful admission spike; no `packages/shark-broker/`, `sharkd`, exported client, durable outbox, or broker services | Complete the research gates before freezing the schema |
| Phase 3 agent adapters | #39 adds Claude/Codex permission hooks and OpenCode v2 permission polling, not native conversations or deferred continuation | All three SSHuv adapters and desktop-started discovery remain required |
| Phase 4 completion integration | Structured completed-turn producer/consumer absent | Explicit lifecycle integration and duplicate suppression |
| Notification taps | Current SHark iOS opens its own detail/inbox first; URL validation allows HTTP/HTTPS, not `sshuv://` | Scoped forwarding plus signed SSHuv universal-link acceptance |
| Running production | Read-only inspection matched healthy container and deployment record to `602bc3b242821e594fa8d32d6db49999eaaf6305` | Does not prove installed client versions, device receipt, or agent delivery |

The production snapshot predates withdrawal (#38), permission bridges (#39), Expo patch refresh
(#40), and browser inbox refresh (#42). The source at that deployed SHA includes Phase 1, but that
does not update a separately installed CLI. No real notification, reply, or session-admission test
was performed for this refresh. The separately observed failed production backup run is an
operational issue to resolve before a future deployment requiring the normal backup gate, not work
authorized by this plan edit. Do not retry backups, deploy, restart, or modify live hooks here.

### Source landmarks

Use these files and symbols rather than historical line numbers; proposed files are called out
separately in the milestones:

- `packages/sharkctl/src/cli.mjs`: `notify ask` expiry calculation and create/wait paths.
- `packages/sharkctl/test/cli.test.mjs`: blocking expiry regression fixtures.
- `packages/contracts/src/index.ts`: `interactionCreateSchema`,
  `agentNotificationCreateSchema`, `webUrlSchema`, and response schemas.
- `apps/website/src/server/routes/interactions.ts`: creator-token isolation, idempotent creation,
  mixed device inventory, get/wait/cancel, response compare-and-set, and notification URL fanout.
- `apps/website/src/server/routes/macos.ts`: macOS interaction responses.
- `apps/expo/src/lib/interactions.ts`: `handleNotificationResponse` and durable reply queuing.
- `apps/expo/app/_layout.tsx`: cold/warm notification response handling;
  `apps/expo/app/inbox-detail.tsx`: current separate Open link action.
- `packages/sharkctl/src/permissions/ask.mjs`, `hook.mjs`, and `opencode-v2.mjs`: existing
  approval bridges to migrate/coexist safely, not full conversation adapters.
- `apps/website/src/server/routes/hooks.ts`: webhook withdrawal; this is not an agent-notification
  recall API and must not be assumed to be one.

Refresh validation: nine selected existing CLI fixture tests passed with
`node --test --test-name-pattern='expiry|expires|clamp|warning|poll' packages/sharkctl/test/cli.test.mjs`.
They exercise existing behavior, not the proposed broker or SSHuv integration. Full application
tests, installed-client rollout, physical notification delivery and session admission remain open.

## Current State

SHark already supports the blocking path:

- `sharkctl notify ask <prompt> --text --wait` creates a reply interaction and waits for an answer
  (`packages/sharkctl/src/cli.mjs`).
- `sharkctl interaction wait <id>` resumes waiting after a client-side timeout (`cli.mjs`).
- The returned interaction includes the user's text in `interaction.response`
  (`apps/website/src/server/routes/interactions.ts`).
- The iOS client queues replies durably in SecureStore with per-interaction dedupe
  (`apps/expo/src/lib/interactions.ts`), and the server atomically accepts only the first
  valid response via a conditional update on `status = 'pending'` (`interactions.ts`).
- The native macOS menu bar companion (PR #31, `apps/macos/`) is a second reply-capable surface.
  It registers through `POST /api/macos/devices` (`macos:register` scope) and answers approval,
  yes/no, and free-text prompts through `POST /api/macos/interactions/:id/respond`
  (`macos:respond` scope), which validates the action digest and applies the same atomic
  conditional update (`apps/website/src/server/routes/macos.ts`,
  `macosInteractionResponseSchema` at `packages/contracts/src/index.ts`). Interaction
  fanout pushes to active macOS companions with reply-capable notification categories
  (`interactions.ts`). Unlike the phone route, the macOS route does not set
  `respondingDeviceId`; the broker must consume only `status` and `response`, never the responding
  device identity.
- Interactions also fan out to web-push subscriptions, but web push remains notification-only in
  v1: the browser service worker displays the notification and opens the dashboard
  (`apps/website/public/sw.js`); the dashboard directs the user to respond from a
  registered iPhone (`apps/website/src/client/components/InboxPanel.tsx`), and the phone
  response route requires an active registered `deviceId` (`interactions.ts`). Browser
  reply UI and browser response credentials are out of scope.

### Contract facts that constrain this design

- **Token scoping.** `GET /interactions/:id` and `/wait` resolve interactions by
  `requesterTokenId`, not by user (`interactions.ts`). Whatever process polls for an answer
  must hold the same API token that created the interaction. This drives the ownership model below.
- **Wait endpoint mechanics.** `/interactions/:id/wait` holds a connection for at most 25 seconds
  and polls the database every 250 ms while waiting (`interactions.ts`). It is cheap for a
  blocking question and expensive if held hot for a day.
- **No list endpoint.** The agent API exposes only get, wait, and cancel by id
  (`interactions.ts`). Pending interactions cannot be enumerated from the server; a local
  registration store is the only index.
- **Limits.** Prompt max 2,000 chars, title max 80, expiry 30 s to 24 h with a **900 s default**
  (`packages/contracts/src/index.ts`); replies max 4,000 chars from both the phone
  (`index.ts`) and the macOS companion (`index.ts`).
- **Cancel exists.** `POST /interactions/:id/cancel` withdraws a pending prompt
  (`interactions.ts`).
- **Idempotency.** Interaction creation accepts an `Idempotency-Key` (`interactions.ts`).
- **Exit codes.** `sharkctl` exits 7 when no provider accepted the push (`cli.mjs`); a push
  nobody received will never produce a reply and must surface as a failure, not a silent success.
- **Reply-capable targets.** Unqualified interaction creation fans out to active iOS devices,
  active web-push subscriptions, and active macOS companion devices (`interactions.ts`).
  Web push cannot answer in v1; iOS devices and macOS companions can. Therefore `accepted > 0`
  proves a reply-capable target only when the request explicitly contains registered iPhone or
  macOS companion device ids.
- **Mixed device inventory.** `GET /api/agent/devices` now returns iOS, web-push, and macOS
  entries in one list sorted by `lastSeenAt`, each carrying a `platform` field
  (`interactions.ts`). Reply-capable selection must filter to active `ios` and `macos`
  entries explicitly.

### Existing callback mechanism (considered and rejected for this design)

SHark webhook-service notifications already support a `correlationId` and a server-pushed response
callback with bearer token and bounded retries
(`apps/website/src/server/lib/interaction-callbacks.ts`, documented in
`apps/website/src/shared/docs/content.ts`). This is the "push the answer to me" alternative
to local polling. It is rejected here because it requires a publicly reachable HTTPS endpoint on
the agent host, which is an explicit non-goal; local hosts sit behind NAT and should not expose a
callback surface for this feature. Note the asymmetry for the record: `correlationId` exists only
on the webhook path, not on the agent `interactionCreateSchema`. The broker does not need it —
interaction ids are returned at creation — but adding it to the agent path is the natural minimal
server change if durable server-side correlation is ever wanted. V1 deliberately makes no such
change.

What is missing is durable routing from an answered interaction to a session whose previous turn
has already ended. SHark knows the requesting token; it does not and should not know how or where
to resume a local agent harness.

## Recommended Shape

Keep the SHark server responsible for interaction delivery and response storage. Add a local reply
broker responsible for interaction creation, registration, and session routing.

```text
agent or completion hook
        |
        | turn-complete request (summary, question, session ref)
        v
 local reply broker ---- create interaction (broker's token) ----> SHark ----> iPhone / macOS companion
        |                                                            |
        | durable registration                                       | typed reply
        |                                                            v
        +------------------- bounded poll / wait <-------------------+
        |
        | harness adapter
        v
existing or resumed agent session
```

Do not store local paths, process identifiers, or harness credentials in the SHark database. Do not
make the production server call arbitrary local commands or private callback URLs.

### Token and ownership model

Because reads are scoped to the creating token, the broker package **creates deferred interactions
with its own dedicated token**. The package's `turn complete` command creates the interaction and
writes the registration to the shared store; the daemon later polls it using the same credentials.
This:

- guarantees the broker can always poll what it registered;
- keeps creation and registration in one CLI operation, with cleanup if either half fails;
- keeps agent-held tokens out of the deferred path entirely.

Standalone blocking questions may keep using the agent's own token through plain `sharkctl`.
SSHuv-managed live questions/approvals must instead use the coordinated ownership path below;
do not run a legacy hook and a new SSHuv bridge as independent owners of the same request.

**Multiple hosts (settled).** Each host runs its own broker with its own API token. Because the
server scopes interaction reads to `requesterTokenId`, hosts cannot see or consume each other's
interactions even under one SHark account. Do not share broker tokens across hosts.

## SSHuv Integration Contract and Research Gates

These requirements extend the deferred-only broker design. The wire schema, exported local API,
and exact agent methods remain provisional until the spikes below are recorded. No fictional
method name in an example is a verified agent API.

### Ownership and data flow

| Component | Owns | Must not become |
| --- | --- | --- |
| SHark server | Notifications, interactions, response storage, current authentication and device delivery | Agent transcript store, terminal proxy, arbitrary command executor, or private-host callback service |
| SHark iOS | Existing reply actions/inbox and narrowly scoped SSHuv destination forwarding | A generic arbitrary-scheme redirector or an auto-approval surface |
| Host broker/adapter layer | Durable event/interaction correlation, replay, response arbitration, agent admission and recovery | A second competing owner of an already-running agent process |
| SSHuv host bridge | Authenticated phone access, native conversation snapshots/events and Herdr routing; delegates shared mutation decisions to the broker/adapter layer | A public unauthenticated broker API or independent duplicate permission hook |
| SSHuv iOS | Native conversation UI, draft/input intent, approvals, terminal controls and trusted destination resolution | Holder of every host's SHark creator token or a client that executes commands from a URL |

Plan for direct, authenticated phone-to-host access for transcripts and terminals; SHark only
carries bounded notices, interactions, and navigation references. The exact SSH/tunnel or private
network transport, pairing, host discovery, key storage, reconnect, and certificate/host-key policy
must be selected in SSHuv planning before the host bridge ships. This does not authorize opening a
new public port or reusing production agent credentials.

The existing broker CLI/daemon no-network-RPC arrangement can remain: expose a bounded, versioned
local library or structured command interface for the trusted SSHuv bridge. Choose that seam in the
spike; do not let SSHuv manipulate internal SQLite rows, copy the broker state machine, or expose
the database over the network. Read-only subscriptions must not gain input authority. The bridge
must survive a disconnected/suspended phone without depending on iOS background execution.

### Conversation and event identity

Define and test a versioned local envelope before implementation:

- Stable host identity, agent kind/version, agent-native conversation/session identity, and a
  conversation generation or equivalent protection against recycled identifiers.
- Optional Herdr workspace/tab/pane association, independently refreshed when panes close, move,
  split, or change occupants. Neither a pane number, terminal title, PID, working directory nor
  SHark's push `conversationId` is sufficient to identify an agent conversation.
- Agent-native turn and active request identifiers, request kind and revision/digest, lifecycle
  event identity/revision, observation cursor, and timestamps. A permission decision is not a
  free-text follow-up turn. Preserve full tool/request context locally for native rendering.
- Stable notification idempotency key, SHark interaction/notification id when created, creating
  token identity, exact persisted create payload, and stable agent-delivery id for mutations.
- An opaque navigation reference mapped to the local conversation and optional event/request;
  it carries no credential, shell command, raw path, prompt, transcript, or permission grant.

These are required semantics, not permission to fabricate IDs from missing agent metadata. The
capability probe must report `unsupported`/`unknown` when identities cannot be established. Do not
merge conversations across hosts or infer permission to attach from a URL or terminal title.
Persist enough identity to survive bridge/broker restarts and a delayed notification tap. Resolve
the current authoritative state before showing a still-actionable request.

### Three native agents and desktop-started discovery

Each adapter must prove discovery of pre-existing desktop work, transcript snapshot plus incremental
tool/message updates, reconnect/cursor reconciliation, live status, prompt admission, question
answers, permission decisions, and safe inactive-session continuation. Record actual supported
versions and capabilities; fixtures are necessary but not evidence of live compatibility.

| Required v1 agent | Admission/discovery gate | Does not count as completion |
| --- | --- | --- |
| OpenCode v2 | Verify the actual v2 discovery, event, message, question and permission APIs; busy/wake semantics and durable admission dedupe | OpenCode v1 plugin compatibility, or only the existing v2 permission endpoints |
| Codex app-server | Verify supported app-server discovery/read/subscription/resume/start and active approval/question response methods; prove desktop session ownership and reconnect behavior | Codex CLI notification hooks, reading logs alone, or spawning a competing process |
| Claude CLI | Verify the supported structured CLI integration, existing-conversation discovery, live input/request handling, and exclusive inactive resume behavior | Transcript tailing plus blind `claude --resume`, or a permission-only hook |

For each agent, test active, busy, idle, exited-but-resumable, deleted, moved, and unreachable
conversations. Distinguish a temporary connection failure from definitive deletion. Prove that
multiple clients can observe without racing input, and that adding one-time host integration does
not require future conversations to originate on the phone. If an agent cannot expose existing
live work safely, record the blocker and return to the user; do not call terminal fallback or
phone-launched sessions a completed native integration.

Moshi is research input, not a preselected implementation dependency. The reviewed current
`rjyo/homebrew-moshi` repository distributes a helper binary without its daemon source; archived
`rjyo/moshi-hooks` has public source and an MIT manifest declaration but no full LICENSE file in
the inspected tree. Confirm the actual reusable artifact and licensing obligations before copying
code. Neither source inspection established OpenCode v2 or Codex app-server support. A first-party
adapter may be needed without changing the three-agent release requirement.

### Herdr passthrough and control ownership

SSHuv owns the Herdr/terminal implementation; SHark must preserve enough opaque correlation to
return to the correct native conversation and associated terminal. Investigate Herdr's documented
terminal controller versus observer streams as the candidate passthrough surface, including input,
resize, scroll, release, reconnect, and ownership loss. Test against the actual supported Herdr
version rather than assuming the inspected checkout represents all installed hosts.

The precise passthrough UX and desktop/phone takeover policy remain a Wayfinder decision. Required
safety invariants are explicit controller acquisition/release, no hidden takeover on notification
tap, no resize/input from read-only observers, and no accidental double execution when moving
between native input and the terminal. Herdr terminal ownership and agent-turn ownership are
separate concerns; a terminal control lease does not prove safe agent API admission.

### One response authority across desktop, SHark, and SSHuv

Preserve the original **new turn** rule only for a reply to a completed turn. Live questions and
approvals must use the agent's active request API and lifecycle, not inject an ordinary prompt or
type text into a terminal. Approval kind, scope, tool identity, and request revision must remain
bound to the exact current request. A tap opens context; it does not approve anything.

The host broker/adapter layer is the shared mutation coordinator for SSHuv-managed work. It must:

1. Correlate every surface with the same stable request/event; avoid parallel legacy and new hooks
   creating two prompts. Inventory and migrate existing permission bridges per host with a rollback
   path, preserving unrelated hook configuration.
2. Reconcile agent-native request state before admission. The desktop can answer independently;
   only the authoritative agent request and durable admission outcome establish whether input
   still applies. Unknown state must not be treated as permission to retry.
3. Atomically claim a request/revision locally and use verified harness-side dedupe or a proven
   reconciliation strategy across the delivery/crash boundary. A local lock alone does not make
   a remote mutation exactly once. If the harness cannot provide this guarantee, stop automatic
   ambiguous retries and keep a visible recovery state; do not ship the adapter as complete.
4. Distinguish **stored in SHark**, **queued on the host**, and **accepted by the agent**. SHark's
   first-response compare-and-set covers only its own interaction. A later-polled SHark response
   may be superseded by a desktop/SSHuv answer already admitted by the agent; reconcile it without
   creating a second turn or silently reporting success. Preserve losing/conflicting input for
   bounded, protected recovery where appropriate, rather than executing it out of context.
5. Settle/cancel the corresponding SHark interaction when another surface resolves the request;
   handle `replied` versus cancellation races without delivering twice. Return resolved/stale/
   superseded state to SSHuv and reconcile it after reconnect. Never auto-approve a reissued request
   because an older request with similar text was approved.

The existing agent creator credential cannot simply impersonate SHark's registered mobile
response credential. Native SSHuv input goes through its authenticated host channel and the
shared arbiter, not an invented server response endpoint or copied SHark device token. The spike
must document conflict precedence, user-visible outcomes on each surface, and how stored SHark
responses converge when another surface wins. If current contracts prevent the required truthful
UX, that is an explicit contract-change gate, not a reason to omit native approvals.

### Lifecycle notifications and recoverable delivery

- Define needs-input, completed, and failed from structured agent state; distinguish request
  cancellation, temporary disconnect, tool failure, and terminal turn failure. Do not infer them
  from terminal text or make a notification for every streamed token/tool update.
- A completion with an explicit question remains one combined done-and-question interaction;
  completion without a question and failure use plain notices. An active question/approval is
  associated with its request and exact destination. Suppress duplicate legacy completion/hooks.
- Extend the broker's local idempotency record into a durable SSHuv event outbox for **all three**
  notice types, including plain completion/failure. Persist the normalized payload and destination
  before sending; event/cursor recovery must not lose a notice between observing and sending it.
  Plain events need not be pending reply registrations, but idempotency alone without durable
  outbox recovery is insufficient. A completed no-question SSHuv event requires conversation
  identity even though the standalone `turn complete` command below may omit it.
- Use bounded previews within character and encoded-payload limits; keep transcripts and sensitive
  tool arguments on the host. Resolve lock-screen preview policy before rollout. Do not include
  credentials in logs, notification bodies, destinations, or analytics.
- Scope SSHuv delivery to the user's enrolled, intended SHark iPhone device(s); verify required
  token scopes and device-routing entitlement. Do not assume `accepted > 0` from macOS/web fanout
  means the phone was reached. Existing non-SSHuv notification fanout remains unchanged.
- Retry with the same event identity and exact payload after ambiguous sends. Persist processing,
  accepted, failed, and unknown delivery states honestly. An idempotent replay does not necessarily
  restart provider delivery; permanent and ambiguous outcomes need recovery, not a fresh key that
  might duplicate a notice. A failure notice must not recursively create more failure notices.
- Require host-side collection/polling while the phone is asleep, with bounded backoff and a
  reconnect snapshot for missed events. Specify expiry and stale/coalescing policy; never reissue
  resolved approvals automatically or replay a backlog of obsolete actionable notifications.
- Interaction cancellation is not guaranteed notification-center recall. The existing webhook
  withdrawal route is not a general agent-notification withdrawal API. If recall is desired, prove
  a compatible route or track an explicit extension; stale-tap revalidation is required regardless.

### SHark-branded, one-tap handoff to SSHuv

Use the existing notification/interaction `url` field with a versioned **HTTPS** destination.
The exact controlled origin, path namespace, and opaque-reference representation remain open.
Do not invent a production hostname or relax `webUrlSchema` to accept arbitrary custom schemes.
SHark's notification grouping `conversationId` is not the agent conversation identifier.

Required implementation and proof:

1. In SHark iOS, route only **default notification taps** for the explicitly configured SSHuv
   HTTPS origin/path to the destination before inbox navigation. Validate scheme, exact origin,
   port/path, encoding, version, and bounded opaque reference with a strict parser. Fail closed to
   SHark detail for malformed, untrusted, or unsupported destinations. Do not follow arbitrary
   redirects or run any agent action from URL contents.
2. Preserve SHark's approval/deny/yes/no/free-text action handling and durable response queue.
   Inline reply actions must not become navigation; non-SSHuv default taps must keep their present
   behavior. Deduplicate cold-launch response consumption and warm-tap callbacks.
3. SSHuv must own the signed associated-domains entitlement and HTTPS site association, plus
   cold/warm universal-link handlers. Host the association file and safe web fallback on an
   approved user-controlled origin; SHark need not register SSHuv's raw APNs token as an Expo token.
   Verify app/site association on installed builds, not just configuration files.
4. Opening the destination resolves only enrolled hosts, authenticates separately, restores the
   exact conversation, refreshes its state, and highlights the event/request when still relevant.
   It must not attach terminal control, start a new turn, or run commands as a side effect.
5. If SSHuv is missing, association is unavailable, the host is offline, or the conversation was
   removed, provide an honest recoverable state and retained SHark inbox access. A destination
   must not leak session details on a public fallback page or substitute a different conversation.
   Persist a pending navigation intent through authentication/reconnect without auto-submitting it.
6. Prove one-tap handoff from SHark to SSHuv on **shuvtest-phone** with SSHuv cold, warm, and
   backgrounded, plus a locked-phone notification after user unlock. Cross-app universal-link
   handoff is an iOS feasibility gate, not established by `Linking.openURL` or a browser test.
   If iOS behavior requires a different design, return to the user; do not silently accept two taps.

## Proposed Interfaces
### Blocking question

Continue using the existing command. Server expiry and client wait are distinct clocks. In source
since #33, `--wait --timeout X` derives expiry from the timeout when both flag and stdin expiry are
absent; explicit expiry wins and the derived value is clamped. The inspected installed CLI predates
that behavior. **Until the installed artifact is verified, pair them explicitly:**

```bash
sharkctl notify ask "Which deployment target should I use?" \
  --text --device "$REPLY_DEVICE_ID" \
  --wait --expires-in 30m --timeout 30m
```

For a blocking ask, resolve the intended reply-capable devices with `sharkctl devices list` — the
response mixes iOS, web, and macOS entries with a `platform` field — select active `ios` or
`macos` entries, and pass their ids with `--device` (repeatable). Do not rely on an unqualified
`accepted > 0` when web push is enabled: a browser subscription may accept the notification but
cannot submit a reply in v1.

Implemented in #33 and retained as the regression contract: when `notify ask --wait --timeout X` omits both the `--expires-in` flag and
`stdin.expiresIn`, derive the interaction expiry from the timeout. Clamp the derived value to the
server range of 30 seconds through 24 hours; when the ask is effectively a Live Activity, clamp it
to 30 seconds through the existing 8-hour Live Activity maximum. "Effectively a Live Activity"
means the same combined boolean the CLI already computes — the `--live-activity` flag **or**
`stdin.presentation === "live_activity"` (`packages/sharkctl/src/cli.mjs`) — not the flag
alone; otherwise a stdin-presentation ask with a long `--timeout` would derive an expiry above
8 hours and hit the existing hard `UsageError` (`cli.mjs`) instead of clamping. Explicit
flag or stdin expiry always wins. This rule does
not apply to `--poll`. Emit a stderr warning whenever the wait timeout exceeds the effective expiry,
because waiting beyond expiry is pointless. `--wait` without `--timeout` remains unchanged: its wait
duration defaults to the effective interaction expiry. Record this accepted CLI behavior delta in
`docs/upstream-delta.md` and update `packages/sharkctl/README.md` as well as the skill.

The #33 update to `skills/shark/SKILL.md` makes genuinely blocking free-text questions prefer this path over
yes/no prompts or an unanswered question in chat. The agent reads `interaction.response` and
continues the same turn, branching on exit status (`0` replied, `4` timeout/expired/canceled,
`7` no selected reply-capable provider accepted the push). Exit `5` (denied/no) cannot occur for a
`--text` ask, but the skill's existing exit-code documentation for approval and yes/no prompts
(`skills/shark/SKILL.md`) covers it and must not regress in this update.

### Completed turn with a question

Add a completion operation to the broker's `sharkd` binary, not to `sharkctl`:

```bash
sharkd turn complete \
  --summary "Implementation and tests are complete." \
  --question "Should I open the pull request?" \
  --title "Agent task" \
  --session-ref-file "$HARNESS_SESSION_REF" \
  --idempotency-key "$TURN_ID"
```

Behavior:

- Without `--question`: send a plain completion notification (equivalent to `sharkctl notify`) and
  exit. `--session-ref-file` is not required. No registration or reply path is created. The
  idempotency key remains required so completion-hook retries do not duplicate the notification.
  The trimmed summary is truncated to the 2,000-character notification body limit
  (`packages/contracts/src/index.ts`). This path uses unqualified fanout: web push and macOS
  companions may receive
  the notification because no reply is needed. `accepted === 0` exits 7; notifications have no
  general agent-notification cancel endpoint, so nothing is canceled and no reply registration is
  written. The standalone path retains its idempotency record; SSHuv events require the durable
  outbox extension above. Note that server idempotency namespaces are per endpoint
  (`agent_notification` versus `interaction` tables), so the same key retried first without and
  then with `--question` would not conflict server-side; the broker's local key-uniqueness check is
  the only cross-shape protection and must treat that sequence as a hard local conflict.
- With `--question`: ask the broker to create a text interaction whose visible prompt combines the
  summary and question, target reply-capable devices (registered iPhones and macOS companions)
  explicitly, register it durably, and
  return immediately. `--session-ref-file` is required. The broker lists devices with its dedicated
  token, filters the mixed-platform response to active `ios` and `macos` entries, and puts at most
  the 50 most recently seen reply-capable ids in `deviceIds`, matching the server
  contract maximum; web-push subscriptions are notification-only in v1. The create payload is
  persisted byte-stable so replay produces an identical request; the server itself dedupes and
  sorts `deviceIds` before hashing and orders fanout by its own `lastSeenAt`
  (`packages/contracts/src/index.ts`, `interactions.ts`), so id order carries no server-side
  meaning and is preserved only for local replay stability.
- Deferred questions expire after 8 hours by default; `--expires-in` may raise this to the server's
  24-hour maximum. An expired question is archived silently with no reminder or automatic re-ask.
- Trim leading and trailing whitespace from summary, question, and title before validation and before
  persisting the create payload; reject an empty question. The exact prompt template is
  `${summary}\n\n${question}` when at least one normalized summary character plus the two-newline
  separator fits. Truncate only the summary to make that template fit. If no summary character and
  separator fit, omit both and send the normalized question alone; therefore a question of exactly
  2,000 characters remains valid. Reject a question above 2,000 characters rather than truncate it.
  `--title` is optional, defaults to `SHark`, and is rejected above 80 characters rather than
  silently truncated. These normalized values are the values covered by idempotency hashing.
- `--idempotency-key` is trimmed before validation, local uniqueness checks, persistence, and remote
  submission; the normalized value is required and must contain 1 to 200 characters. Harness hooks
  derive it from stable session and turn identifiers before invoking `sharkd`; the broker does not
  invent a key from incomplete metadata. Reusing a normalized key with any different create payload
  is a hard conflict.
- If device discovery finds no active reply-capable device (iPhone or macOS companion), no
  interaction is created and the command
  exits 7. If creation returns the server's definitive `Invalid device selection` validation error,
  the idempotency key was rejected before interaction insertion (`interactions.ts` precedes the
  insert at `interactions.ts`). Mark that local `creating` row `rejected` and exit 1; a later
  invocation may replace that rejected payload after fresh discovery while retaining the same key.
  This is the only allowed payload-replacement exception. Any successful or ambiguous create
  attempt must replay the exact persisted payload. Classification of this outcome is deliberately
  strict: it requires HTTP status 400 **and** an error body whose `error` field is exactly
  `Invalid device selection`; anything else falls into the general outcome matrix. Because this is
  a human-readable message rather than a machine code, a broker fixture test pins the server
  literal, and `docs/upstream-delta.md` records the string alongside the fork's other pinned
  compatibility names so upstream Hark merges that reword it are flagged instead of silently
  degrading the replacement path into terminal `rejected`.
- If a non-idempotent initial response reports `accepted === 0`, the command exits 7. Because SHark
  has already created the interaction, the broker first persists the returned interaction id and
  enters a `canceling` state, then cancels it server-side. Successful cancellation archives the local
  row as `undeliverable`; failed cancellation retains the row for cleanup retry. An idempotent zero
  follows the separate `reconciling_zero` rule below and exits 6 while unresolved. A prompt nobody
  received must not remain as an untracked pending server interaction.
- If the initial adapter probe is `unknown`, no interaction is created and the command exits 6 as a
  transient local/harness failure. The completion hook may retry with the same idempotency key.

`sharkd` uses stable process exit codes: `0` accepted/successful, `1` permanent runtime failure, `2`
usage or validation error, `3` broker credential/configuration failure, `4` definitive missing or
terminal target, `6` transient network/harness failure, and `7` no active reply-capable device or no
selected provider accepted the notification. Machine-readable stdout contains no token or reply
text unless the operator explicitly runs `queue show`.

The session reference is produced by trusted harness integration code, never assembled from the
user's reply. It is a versioned common envelope plus an adapter-validated bounded JSON object:

```json
{
  "version": 1,
  "harness": "opencode-v2",
  "sessionId": "opaque-session-id",
  "cwd": "/trusted/project/path",
  "adapterData": {}
}
```

The broker rejects session-reference files above 64 KiB, JSON nesting deeper than 8 levels,
`sessionId` above 512 characters, `cwd` above 4,096 characters, and `adapterData` whose serialized
form exceeds 16 KiB. It validates `version`, `harness`, `sessionId`, and optional `cwd`; the selected
adapter validates the bounded `adapterData`. This avoids central schema churn without accepting
unbounded arbitrary configuration. None of these local fields is sent to SHark.

### Reply broker

One registration operation hides polling, persistence, retry, and harness differences:

```ts
register({ summary, question, session, expiresAt, idempotencyKey })
// broker creates the interaction and returns { interactionId }
```

Harness-specific behavior sits behind one adapter seam:

```ts
interface SessionAdapter {
  probe(session: SessionRef): Promise<"available" | "missing" | "unknown">;
  deliver(session: SessionRef, message: DeferredReply): Promise<DeliveryResult>;
}

type DeliveryResult =
  | { status: "delivered" }
  | { status: "busy" }
  | { status: "failed"; retryable: boolean; diagnostic: string };
```

The common result vocabulary is provisional until the OpenCode v2 and cross-surface spikes. The
spikes must prove how each required agent distinguishes admission, busy/queued delivery, definitive missing sessions, ambiguous
network failures, wake behavior, and durable `deliveryId` deduplication. Record the observed API and
revise this seam before creating the broker schema. This deferred-only interface is not the full
SSHuv snapshot/event/question/approval API. Adapter diagnostics must not contain reply text,
tokens, or local credentials.

The broker:

- persists pending registrations in a local SQLite database using Node >=22.13.0's built-in
  `node:sqlite`
  `DatabaseSync` API in WAL mode; the CLI and daemon share this database directly, with a bounded
  busy timeout and no local RPC or HTTP surface. This avoids adding a native package dependency to
  the otherwise dependency-light broker;
- treats the local store as the **sole index** of pending deferred interactions — the server cannot
  enumerate them, and store loss is unrecoverable by design in v1 (documented and backed up with
  the host's normal backup policy);
- creates registrations through a crash-safe state machine: after a successful initial adapter
  probe, transactionally insert a `creating` row containing the exact complete SHark request JSON
  and normalized idempotency key plus the preflight `token.id`, call SHark, then attach the returned
  interaction id and server `expiresAt` and mark it `pending`. Replay uses the byte-equivalent
  persisted create payload, including the original `expiresInSeconds`, so the server request hash
  cannot change. On startup, replay any `creating` row with the same key so SHark returns the same
  interaction instead of creating an orphan. Poll, replay, and cancel are blocked when the currently
  loaded token id differs from the row's persisted token id;
- handles a non-idempotent initial create response with `accepted === 0` by persisting the returned
  interaction id, transitioning to `canceling`, and invoking the server cancel endpoint. A successful
  cancel archives the row as `undeliverable`; a failed or ambiguous cancel remains durable and is
  retried. The command exits 7 on this synchronous initial path;
- does not treat an idempotent replay response with `accepted === 0` as definitive, because a
  concurrent original request may have inserted the row but not yet persisted push results. It enters
  `reconciling_zero`, cold-polls get/status, promotes to `pending` if `accepted > 0`, processes any
  terminal response normally, and otherwise retains the tracked row until expiry or explicit operator
  cancellation. V1 makes no unsafe timing assumption and adds no server processing-state contract;
- classifies create outcomes deterministically: `401`/`403` becomes durable `auth_blocked` and exits
  3; `409` idempotency mismatch becomes terminal `conflict` and exits 1; `429`, network errors,
  malformed/aborted responses, and `5xx` remain replayable `creating` and exit 6; definitive
  `Invalid device selection` (status 400 plus the exact pinned error string, per the strict
  classification above) becomes `rejected` with the sole payload-replacement allowance described
  above and exits 1; every other `4xx` becomes terminal `rejected` with no payload replacement and
  exits 1; a valid response with `accepted > 0` becomes `pending` and exits 0;
- polls **cold** for deferred questions immediately at daemon startup, then every 45 seconds with
  ±10% jitter, not through a continuously re-issued hot `/wait`. Network errors use exponential
  backoff capped at 15 minutes. A hot wait costs ~4 DB reads/sec per registration on the server for
  up to 24 h and buys nothing for a question that is not blocking anyone;
- uses a separately verified active-request response path for SSHuv-managed blocking questions and
  approvals; do not apply the 45-second deferred polling cadence to latency-sensitive live input.
  Select and measure bounded wait/event behavior in the arbitration spike without changing the
  server's existing wait contract or keeping needless hot waits for completed turns;
- assigns every reply a stable `deliveryId` exactly once when the broker first observes the
  interaction in `replied` state, persists it in the same transaction as the reply state, and
  requires adapters to deduplicate it before admitting a turn. An ambiguous crash is retried with
  the same id, producing end-to-end effectively-once delivery rather than choosing between
  duplicates and intentional reply loss;
- queues or retries when the target session is busy;
- retries harness delivery after 5 seconds, 30 seconds, 2 minutes, 10 minutes, and 1 hour; then
  retains the reply as failed for inspection and manual recovery and sends one plain SHark failure
  notification;
- probes the target session before creating an interaction, every 15 minutes while pending, and
  immediately before delivery. A definitive initial `missing` result creates no interaction. A
  definitive later `missing` result transitions to `canceling`, cancels the server interaction and
  archives locally. Notification-center recall is not guaranteed. `unknown` (including network
  failure) backs off and never creates or cancels;
- removes or archives expired registrations; and
- passes reply text as structured data, never shell source.

Cancellation reconciles races from the terminal interaction returned by the server. A successful
cancel archives `canceled`. A `409` containing `expired` or `canceled` archives that state. A `409`
containing `replied` mints/persists the stable `deliveryId` and enters normal delivery; if the session
is definitively missing, retain it as failed for manual recovery and send the one failure notification
rather than discard the user's reply. Any other terminal response is archived with its exact state;
transport ambiguity leaves the row `canceling` for retry with the same token identity.

The resumed user turn includes the stable `deliveryId`, original question, and user's reply so the
adapter can deduplicate admission and the model can interpret the answer in the correct context.

Delivered, expired, canceled, and undeliverable rows are retained for 7 days, then purged. Failed
replies and ambiguous cancel operations remain until an operator explicitly retries or discards
them. `sharkd status` summarizes service state, database access, queue counts, and last successful
poll without reply text; `sharkd queue list|show|retry|discard` provides recovery controls, and only
`show` may print reply text. `discard` on a still-pending or canceling registration must first reach
a terminal server state; if cancellation is ambiguous, discard fails and retains the row.

The no-RPC health contract is a singleton SQLite `daemon_state` row containing random `instanceId`,
PID, absolute executable path, `startedAt`, `heartbeatAt`, `lastPollAt`, and a redacted
`lastErrorClass`. After config validation and database migration, the daemon writes its startup row
and refreshes `heartbeatAt` every 30 seconds even when the queue is empty or SHark is unreachable.
`sharkd status` reports healthy only when the service manager says the recorded PID is running with
the expected executable and the heartbeat is at most 90 seconds old. Service install/restart waits up
to 20 seconds for a new `instanceId` heartbeat, then fails health verification without deleting state
or credentials. Credential preflight occurs in the service command before launch; ordinary later
network/auth failures are represented in `lastErrorClass` and backoff rather than suppressing the
local heartbeat.

### Packaging

The broker, its store, its adapters, and the `turn complete` command live in the new private sibling
package `packages/shark-broker/` named `@hark/shark-broker`, whose executable is `sharkd` and whose
package engine is Node `>=22.13.0`, not inside `packages/sharkctl/`.
Rationale: `AGENTS.md` declares this repo a minimally rebranded Hark fork whose protocol clients
should track upstream; `sharkctl` is the package most likely to need upstream syncing, and a
daemon plus durable store there maximizes merge pain.

Extract sharkctl's current HTTP request primitives from `src/cli.mjs` into
`packages/sharkctl/src/client.mjs`. Add the supported public subpath export
`"./client": "./src/client.mjs"` to `packages/sharkctl/package.json`; keep the existing CLI entry
unchanged. Note that `packages/sharkctl/package.json` currently declares **no** `exports` or `main`
field, so introducing an `exports` map is a published-package behavior change: previously possible
deep imports such as `sharkctl/src/cli.mjs` become external resolution errors. Nothing in this
repository does that (`bin/sharkctl.mjs` uses a relative path and is unaffected), and deep source
imports were never a supported surface. Export `"./client"` and `"./package.json"`, state in
`packages/sharkctl/README.md` that `./client` is the only supported import, and record the accepted
packaging delta in `docs/upstream-delta.md`. The exported surface is deliberately small:
`RequestError`, a generic authenticated
request helper, file config validation, and typed-by-convention helpers for notification creation and
interaction create/get/cancel. `packages/shark-broker/package.json` depends on `sharkctl` via
`workspace:*` and imports `sharkctl/client`; it never imports `src/` by relative path. Re-export the
existing symbols needed by `cli.mjs` so current CLI tests remain valid. This behavior-preserving
refactor avoids hot-path subprocesses, avoids coupling the daemon to CLI argument parsing, and keeps
one implementation of authentication and API error handling.

The broker does **not** call sharkctl's general `loadConfig(env)` unchanged. That function currently
prefers ambient `HARK_TOKEN` over `HARK_CONFIG` (`packages/sharkctl/src/cli.mjs`), which would
violate dedicated-token ownership. The extracted client provides a file-only loader that accepts an
explicit config path, validates mode `0600`, reads `token` and `apiUrl` from that file, and ignores
ambient `HARK_TOKEN` and `HARK_API_URL`. The broker fails closed if the file is missing, insecure, or
invalid.

Before registration, the command calls agent auth status through the extracted client and requires
`notifications:send`, `interactions:create`, `interactions:read`, and `devices:read`. Revoked,
expired, or insufficiently scoped credentials exit 3 before creating a local row. If credentials are
revoked in the race after that preflight, the already-durable `creating` row remains blocked for
operator remediation and is never discarded or replayed under a different token.

V1 supports both Linux and macOS service lifecycle. Linux `shuvdev` is the primary deployment and
uses a per-user systemd service; macOS `shuvbot` is the secondary deployment and uses a LaunchAgent
with keep-alive. The daemon reads a dedicated token from a broker-owned config file (mode `0600`)
provisioned through sharkctl's existing alternate config support:

```bash
BROKER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/shark-broker"
install -d -m 700 "$BROKER_DIR"
env -u HARK_TOKEN -u HARK_API_URL \
  HARK_CONFIG="$BROKER_DIR/hark-config.json" \
  sharkctl auth login \
  --client-name "SHark broker $HOSTNAME" \
  --scope notifications:send \
  --scope interactions:create \
  --scope interactions:read \
  --scope devices:read
```

The token must not appear in the systemd unit, LaunchAgent plist, environment, or shell history.
Only the config path appears in service definitions.

`sharkd service install|status|restart|uninstall` auto-detects the supported host platform and owns
the corresponding service lifecycle:

- **Linux (primary):** resolve the current Node executable and installed `sharkd` entry point to
  absolute paths, install `~/.config/systemd/user/sharkd.service`, run
  `systemctl --user daemon-reload` and `systemctl --user enable --now sharkd`, then verify daemon
  health. The unit uses `Restart=on-failure` and contains paths but no token; the broker's own
  bounded backoff handles network unavailability. Persistent operation after logout/reboot requires
  lingering. `service install` fails closed before enabling the unit when lingering is disabled and
  prints the exact one-time administrator command (`loginctl enable-linger <user>`); it never invokes
  `sudo` itself.
- **macOS (secondary):** resolve absolute Node and `sharkd` paths, write a reviewed LaunchAgent plist
  containing those paths and the broker config path but no token, bootstrap it with `launchctl`,
  enable keep-alive, and verify daemon health.

Both service definitions explicitly remove `HARK_TOKEN` and `HARK_API_URL` from the daemon
environment. The broker obtains the production origin only from its protected config file. Service
installation refuses relative executable paths so later shell or package-manager changes cannot
silently redirect the daemon. Installation also executes an import smoke test for `node:sqlite` and
requires Node >=22.13.0 without an experimental runtime flag before writing either service. Even
unflagged, some supported Node releases emit an `ExperimentalWarning` for `node:sqlite`; pin and
record the actual supported runtime behavior. The smoke test and service-log health checks may
allow that specific observed warning, not suppress arbitrary warnings or treat a missing import
as healthy.

V1 does not support a root-managed systemd unit. Keeping the service per-user keeps the daemon,
credentials, and SQLite state under one `shuvdev` ownership boundary.

Credentials live at `$XDG_CONFIG_HOME/shark-broker/hark-config.json` (fallback
`~/.config/shark-broker/hark-config.json`). SQLite lives at
`$XDG_STATE_HOME/shark-broker/broker.sqlite` (fallback
`~/.local/state/shark-broker/broker.sqlite`). Directories are mode `0700`, files mode `0600`, and
the state directory is included in the host's normal backup boundary.

When the package is added, update `AGENTS.md` architecture and validation commands to include
`packages/shark-broker/`. The package remains private in v1; `sharkd` is installed from the reviewed
workspace/package artifact on each host rather than published as a public npm package.

## Harness Order and Admission Gates

OpenCode v2 is the first reference adapter for a vertical broker proof, **not** the only SSHuv v1
adapter. Codex app-server and Claude CLI are also release blockers. `shuvcode` in the original plan
was an unverified host-integration assumption; do not conflate it with either OpenCode v1 or a
proven OpenCode v2 contract. Existing OpenCode permission routes establish no prompt-admission API.

Run bounded feasibility spikes for all three agents and cross-surface arbitration before freezing
the common store/seam. Implement the OpenCode v2 vertical slice first, then the other required
adapters against their verified capabilities. Treat historical method guesses (`thread/resume`,
`turn/start`, `asyncRewake`, or any `/prompt` endpoint) as research leads only until current
documentation and a controlled real-session result establish the exact supported contract.

shuvpi and Grok remain possible later adapters outside the SSHuv v1 critical path. No OpenCode v1
compatibility layer is planned. A missing required-agent capability must be reported as a blocker,
not hidden by replacing native support with terminal access.

## Phases

### Phase 1: Blocking Questions

**Implemented in source by #33.** The following records the delivered scope and regression
requirements, not a request to rebuild it. Installed-host artifact rollout remains open.

- Strengthen `skills/shark/SKILL.md` guidance for free-text blocking questions, including the
  explicit `--expires-in`/`--timeout` pairing for older clients and the implemented derivation
  for updated clients, explicit reply-capable device targeting (active
  `ios` and `macos` entries) when web push is enabled, and exit-code branching, without regressing
  the existing exit-5 (denied/no)
  documentation for approval and yes/no prompts.
- Modify `packages/sharkctl/src/cli.mjs` so omitted expiry for `--wait --timeout` follows the exact
  clamped derivation above — keyed on the effective Live Activity boolean (flag or
  `stdin.presentation`), not the flag alone — and emits the ineffective-wait warning.
- Update `packages/sharkctl/README.md` and `docs/upstream-delta.md` for the accepted behavioral delta.
- Add focused coverage in `packages/sharkctl/test/cli.test.mjs` for flag and stdin precedence,
  30-second and 24-hour clamps, the 8-hour Live Activity clamp via both the `--live-activity` flag
  and `stdin.presentation === "live_activity"`, warning behavior, and unchanged `--poll` behavior.
- Document how agents safely extract and process `interaction.response` (untrusted data, max
  4,000 chars, never shell source).
- Add examples that distinguish approval, yes/no, and detailed reply use cases.
- Verify behavior with existing CLI and server tests. This phase changes CLI behavior and guidance,
  not the SHark server protocol.

### Phase 2: Deferred Reply Proof

- **Research gates first:** record each required agent's version, discovery/native-state access,
  active request response, ownership, reconnect, and durable admission behavior. Include a
  desktop-started conversation, a response-loss crash, and a competing desktop/phone answer.
  Record privacy-safe methods, request/result shapes, evidence artifact paths, and limitations in
  proposed `docs/agent-reply-routing/` notes. Tests use disposable sessions; real mutations require
  explicit authorization. A fixture-only result does not close an admission gate.
- Verify OpenCode v2 prompt admission's actual queued/wake semantics,
  missing-session signal, ambiguous failure behavior, and durable delivery-id deduplication against
  a real session. Record the endpoint, request shape, response outcomes, concurrency behavior, and
  evidence before creating `packages/shark-broker/`, its schema, or its adapter seam. Update this
  plan's evidence ledger to link the result. Resolve the host bridge seam and canonical arbitration
  strategy at this gate; unanswered feasibility questions stay blockers.
- Extract and export `packages/sharkctl/src/client.mjs`, add the `sharkctl/client` and
  `./package.json` package exports, record the packaging delta in `docs/upstream-delta.md`, and
  keep broker credentials file-only as specified above.
- Create the sibling broker package with the durable registration store, including the fixture test
  that pins the `Invalid device selection` server literal, and add that string to
  `docs/upstream-delta.md`'s pinned compatibility names.
- Add the minimal broker process and systemd user-service lifecycle on primary Linux host
  `shuvdev`, including the lingering preflight.
- Add the LaunchAgent lifecycle for secondary macOS host `shuvbot` in the same v1 phase.
- Add the `turn complete` command (create-and-register, no waiting, idempotent, exit-7 aware).
- Implement the OpenCode v2 reference session adapter, not the historical unverified shuvcode API.
- Extend persisted identity/outbox and shared response authority for SSHuv as specified above;
  retain the existing standalone blocking/deferred commands without forcing SSHuv adoption.
- Update `AGENTS.md` with the new package and narrow validation commands.
- Verify end to end: creation, process exit, delayed phone reply, session wake, new turn, duplicate
  suppression, expiry, cancel-on-dead-session, and unavailable-session recovery.

### Phase 3: Harness Integration

- Add **Codex app-server and Claude CLI** support with explicit live-session versus process-resume behavior. Each
  adapter begins with a spike that proves its harness-specific liveness check before any resume
  process can be spawned; do not impose an unverified cross-harness convention now.
- Add harness hooks that provide trusted session references and completion metadata.
- Keep adapter-specific configuration out of SHark's server contracts.
- Implement native snapshots, tool/message events, user prompts, active questions and approvals,
  and desktop-started discovery for all three agents through the shared, versioned host seam.
- Inventory `packages/sharkctl/src/permissions/` deployments and coordinate the old permission
  bridges with the new owner. Add coexistence/migration fixtures in the existing permissions test
  suite; preserve standalone behavior and unrelated configuration. Installing duplicate hooks is
  not a migration strategy.
- In SSHuv, implement the authenticated host bridge and Herdr association/control layer; its exact
  code paths must be chosen in that repository because no SSHuv application scaffold exists yet.
- Pass real-session discovery, transcript, question/approval, prompt, busy-session, reconnect,
  terminal/native switching, and duplicate-delivery acceptance independently for all three agents.
  Phase 3 is incomplete if any required agent has only permission hooks or terminal support.

### Phase 4: Completion Detection

- v1 requires an **explicit** structured question supplied by the agent or harness integration.
- Retain a later evaluation of one strict deterministic safety net: only a final paragraph that
  begins exactly `Question for user:` and contains one non-empty question ending in `?` is a
  candidate when the structured field is absent. Evaluate it offline on reviewed fixtures and
  require zero false positives before enabling it. Do not shadow-log production transcript text or
  add a per-turn LLM classifier.
- Summaries are composed by the originating harness; a shared helper only validates and truncates
  the summary to the concrete prompt limit. Questions and titles are validated and rejected rather
  than truncated.
- Add structured needs-input and failed events alongside completion. Persist cursor/checkpoint,
  exact outbox payload, opaque destination, expiry/revision and idempotency before network sends.
- Verify no duplicate done notice when a done-and-question interaction is emitted, no recursive
  failure-notification loop, and no false terminal failure for a transient connection/tool error.
- Test intended iPhone targeting and reconnect catch-up without treating provider acceptance as
  device receipt. Keep full transcripts out of SHark and logs.

### Phase 5: SHark-to-SSHuv iOS Handoff

This phase may prototype in parallel with admission research, but its final destination schema
depends on conversation identity and the selected origin/pairing policy.

- Modify `apps/expo/src/lib/interactions.ts` and `apps/expo/app/_layout.tsx` to distinguish default
  SSHuv taps from notification action replies and non-SSHuv taps. Add a small testable destination
  parser/router in proposed `apps/expo/src/lib/sshuv-destination.ts` with synthetic unit fixtures in
  proposed `apps/expo/src/lib/sshuv-destination.test.ts`. Extend the existing Vitest fixtures in
  `apps/expo/src/lib/interactions.test.ts` and `notification-detail.test.ts`; retain their current
  non-SSHuv inbox-first and inline-response assertions. Run `pnpm --filter @hark/expo test` and
  `pnpm --filter @hark/expo typecheck`, expecting no regressions before signed-device acceptance.
- Preserve `apps/expo/app/inbox-detail.tsx` as a durable fallback. If fallback UI needs a change,
  test missing app, bad association, malformed destination, and unavailable host behavior. Never
  replace an unknown destination with whichever conversation is currently active.
- In the SSHuv repository, choose actual app paths for associated domains, cold/warm URL handling,
  enrollment-aware reference resolution, pending navigation persistence, and request-state refresh.
  Publish the matching site association and non-sensitive web fallback only after the origin and
  deployment owner are selected. Do not edit production domains during this plan refresh.
- Preserve `packages/contracts/src/index.ts` HTTP/HTTPS validation and existing create shapes by
  default. Add relevant URL propagation/regression fixtures to
  `apps/website/src/server/routes/interactions.test.ts` if needed; a server extension requires the
  explicit gap/approval gate described above.
- Document the intentional client behavior delta in `docs/upstream-delta.md`; document versioned
  destinations, setup, required app builds, and recovery in proposed `docs/agent-reply-routing/`.
- Pass signed, installed cross-app tests on shuvtest-phone before claiming one-tap support. If the
  proof fails, keep this phase blocked and bring the evidence back to the user.

### Phase 6: Personal Release and Operational Acceptance

- Pin and record the server SHA/image, broker and CLI artifact hashes/behavior, all three agent
  versions, Herdr version, and installed SHark/SSHuv app build identities. Upgrade the old local
  `sharkctl` artifact deliberately; identical version strings do not prove identical behavior.
- Resolve the remaining decisions below, then document per-host setup, scopes, reply-device
  selection, helper supervision, revoked credentials, offline recovery, and legacy-hook migration.
- Run the full acceptance matrix below; record observed results separately from fixtures. Keep
  partial acceptance visible and do not declare SSHuv v1 ready after only the OpenCode slice.
- Review current `docs/operations.md`, `docs/provisioning-gates.md`, `docs/verification.md`, and
  `deploy/README.md` before any later production rollout. Recheck backup health/restore evidence;
  this planning commit does not authorize fixing the separate backup failure or deploying code.
- Document and test rollback without losing pending replies, route mappings, outbox state, host
  credentials, or the existing SHark inbox. Notification-center cleanup is best effort only.

### Dependencies and Definition of Done

Research/admission evidence precedes the durable contract; the reference broker slice precedes
the remaining production adapters. Identity and the handoff proof precede final destination
implementation. Structured lifecycle/outbox, all three native integrations, and signed iOS
handoff converge at Phase 6. The exact implementation tickets belong to the execution handoff;
this plan records required work and gates without pretending the open design is settled.

SSHuv support is done only when **all** of the following are evidenced: desktop-started native
work for all three agents; functional Herdr passthrough under the chosen control policy; truthful
cross-surface answers/approvals with no duplicate admission; reliable host-side lifecycle
collection and recoverable notification delivery; and one-tap SHark-to-SSHuv exact-conversation
navigation on the signed test-phone builds. Terminal-only, mock-only, or provider-accepted-only
results cannot satisfy those gates.

## Open Decisions and Required Evidence

The user has approved SHark branding, not every mechanism in this plan. Resolve these before the
dependent implementation; do not treat them as permission to defer confirmed v1 capabilities:

| Decision/evidence | Required output | Blocks |
| --- | --- | --- |
| Three-agent existing-session/admission proof | Pinned versions, supported methods, identity, live/inactive behavior, request correlation, dedupe and ambiguity results for each agent | Common three-agent contract and remaining production adapters; staged shuvcode broker authorized separately |
| Cross-surface arbitration | Authority/precedence, stale response UX, atomic admission/reconciliation and legacy-hook migration, including SHark response already stored while desktop wins | Native questions/approvals and reliable deferred replies |
| Herdr passthrough and takeover UX | Exact requested surface, supported version, observer/controller behavior, simultaneous desktop/phone policy | SSHuv terminal acceptance |
| Host enrollment and transport | Supported hosts, trusted pairing, access scopes, key custody/revocation, local bridge API and reconnect protocol | SSHuv host bridge and secure destination resolution |
| Navigation origin/reference lifetime | Controlled HTTPS origin/path, signed association, opaque ID persistence/retention, authentication and absent-app/offline fallback | iOS forwarding and site publication |
| Background notice policy | Preview privacy, stale/coalescing behavior, expiry, intended device routing, permission/push-denial UX and measurable delivery expectations | Notification rollout |
| Native action experience | Exact question/approval variants and whether additional direct-from-notification actions are desired; existing SHark actions must remain safe | Action UX beyond the confirmed native baseline |
| Signed-device and operational readiness | Supported iOS/app builds, physical handoff proof, current host/server artifacts and backup/recovery acceptance | Personal release |

Use a dated evidence ledger with fields: gate, exact source/runtime versions, controlled test
scenario, observed result, artifact location, limitations, and reviewer decision. No live tokens,
reply text, or transcript dumps in that ledger. At this refresh, these new gates are **open**.

## Validation

Minimum automated coverage:

- existing blocking text replies still return the correct response and exit status;
- a blocking ask with `--timeout` and no explicit `--expires-in` gets an expiry of
  `clamp(timeout, 30s, 24h)`, or `clamp(timeout, 30s, 8h)` for an effective Live Activity selected
  by either the `--live-activity` flag or `stdin.presentation === "live_activity"`;
- `stdin.expiresIn` counts as explicit, `--expires-in` overrides stdin, and `--poll` retains its
  existing expiry behavior;
- a blocking ask whose wait timeout exceeds its effective expiry emits a stderr warning;
- blocking guidance targets reply-capable devices (active `ios` and `macos` entries) explicitly
  when web push is enabled;
- `turn complete` returns before the interaction is answered;
- `turn complete` rejects a question that cannot fit within the 2,000-character prompt budget and
  rejects titles above 80 characters; whitespace normalization and summary omission produce the
  exact persisted prompt template at every boundary;
- `turn complete` without `--question` truncates the summary to the 2,000-character notification
  body limit and exits 7 on `accepted === 0`; standalone invocations create no reply registration,
  while SSHuv lifecycle notices persist and recover through their event outbox;
- retrying the same idempotency key first without and then with `--question` is a hard local
  conflict even though server idempotency namespaces are per endpoint;
- `turn complete` with no active reply-capable device creates no interaction and exits 7;
- device discovery deterministically selects at most the 50 most recently seen active reply-capable
  devices, filtering the mixed-platform `/api/agent/devices` response to active `ios` and `macos`
  entries and never selecting `web` entries (asserted against the broker's local selection; the
  server dedupes, sorts, and re-orders ids, so payload order is verified only for byte-stable
  replay);
- a device that exists but went inactive between discovery and create yields a valid selection with
  a possible `accepted === 0` — handled by the cancel-on-zero path — rather than
  `Invalid device selection`;
- `turn complete` with an initial adapter probe of `unknown` creates no interaction and exits 6;
- `turn complete` with a non-idempotent initial `accepted === 0` exits 7, durably cancels the created
  interaction, and leaves no untracked pending interaction; ambiguous cancellation remains visible
  in recovery state;
- retried `turn complete` with the same idempotency key creates one prompt;
- the same idempotency key with a different persisted create payload fails as a conflict;
- a crash in every transition around remote creation is recovered from the prepared `creating` row
  by replaying the same idempotency key, with no orphan interaction;
- replay uses the exact original create payload and handles an idempotent `accepted === 0` response
  through `reconciling_zero` without canceling a potentially in-flight successful delivery;
- the create outcome matrix maps auth, conflict, rate-limit, network, `5xx`, definitive validation,
  accepted-zero, and accepted-positive responses to the specified durable state and exit code;
- a definitive pre-insertion `Invalid device selection` response marks the local row rejected and
  permits fresh-device payload replacement on a later invocation; no other response permits payload
  replacement; classification requires HTTP 400 plus the exact error literal, a fixture test pins
  that literal against the server route, and any other 400 body falls into terminal `rejected`
  without replacement;
- broker state survives restart;
- every row persists the creating `token.id`; changing the broker config token blocks replay, polling,
  and cancellation rather than silently changing the server ownership namespace;
- ambient `HARK_TOKEN` and `HARK_API_URL` cannot override the broker's protected config file;
- broker config loading fails closed for a missing file, a non-`0600` file, malformed JSON, a missing
  or invalid token/API origin, and any ambient `HARK_CONFIG` that differs from the explicit broker
  path;
- revoked or expired broker credentials and credentials missing any required scope map to exit 3,
  create no new local registration, and produce a redacted actionable diagnostic;
- the `sharkctl/client` export works from the broker package without importing sharkctl source paths;
- SQLite opens in WAL mode, honors its busy timeout under concurrent CLI/daemon access, and recovers
  every migration/state transition after restart;
- an idle daemon refreshes its heartbeat, stale or mismatched PID/executable state is unhealthy, and
  install/restart requires a new instance heartbeat within 20 seconds;
- systemd user-service install/status/restart/uninstall works on Linux, fails clearly when lingering
  is disabled before enabling the unit, uses absolute executable paths, contains no token, and
  survives logout/reboot after lingering is enabled;
- LaunchAgent install/status/restart/uninstall works on macOS with absolute Node and `sharkd` paths,
  the explicit broker config path, ambient token/API isolation, no token in the plist, and a clear
  failure when post-bootstrap daemon health cannot be verified;
- ambiguous delivery retries reuse one `deliveryId`, and the adapter admits one new agent turn;
- replies are delivered to the correct harness and session;
- a reply is consumed identically whether it was submitted from an iPhone or the macOS companion:
  the broker reads only terminal `status` and `response` and never depends on `respondingDeviceId`,
  which the macOS route does not set;
- an active session receives queued or follow-up input instead of a competing turn;
- expired, canceled, denied, missing, and deleted-session cases settle predictably, including the
  broker canceling the prompt for a deleted session;
- cancellation races process returned `replied` content through delivery/manual recovery and archive
  returned `expired`/`canceled` states without losing a reply;
- an adapter `unknown` probe result never cancels a prompt, while a definitive `missing` result does;
- existing server coverage proves unqualified interactions may fan out to web push, while broker
  coverage proves deferred interactions contain only reply-capable device ids (`ios` and `macos`)
  and never target or
  deliver to web-push subscriptions;
- reply text containing shell syntax remains inert structured input; and
- no token, callback credential, local path, or reply content leaks into logs unexpectedly.

Repository checks begin with the narrow package tests and builds, then broaden:

```bash
pnpm --filter sharkctl test
pnpm --filter sharkctl build
pnpm --filter @hark/shark-broker test
pnpm --filter @hark/shark-broker build
pnpm typecheck
pnpm test
pnpm lint
pnpm brand:check
```

Before `packages/shark-broker/` exists, omit its two filter commands. Automated tests use synthetic
tokens, device ids, session references, replies, and HTTP fixtures. A physical-phone or real-session
acceptance test may send an actual interaction only with the user's explicit authorization, per
`AGENTS.md`.

Each harness adapter also gets an integration fixture proving a reply reaches a real or faithful
local session interface. Linux lingering/logout/reboot checks and macOS LaunchAgent lifecycle checks
are host acceptance tests, not portable CI requirements; CI must still test generated service files
and command behavior with synthetic fixtures.

### SSHuv Acceptance Matrix

Run the agent rows independently for OpenCode v2, Codex app-server, and Claude CLI; a result for one
agent is not transferable to another. Automated tests use synthetic data. Physical tests use
shuvtest-phone and disposable agent conversations with explicit authorization for real sends and
actions. Reboot, live hook changes, device installs, and production deployment are separate gates.

| Scenario | Required evidence |
| --- | --- |
| Desktop-started work | SSHuv discovers the existing conversation, shows correct history/tool output, answers a question/approval, and sends a new prompt without replacing its identity or starting a competing owner |
| Native/terminal association | Correct Herdr pane is associated even after move/close/reuse; terminal input, resize, scroll, release and reconnect obey the chosen ownership policy without double execution |
| Busy/inactive/missing | Input is queued or rejected truthfully while busy; inactive resume is exclusive; deleted differs from unreachable; unknown state never starts a second process or cancels a valid prompt |
| Cross-surface race | Desktop, SHark and SSHuv answers to the same request result in at most one authorized agent action; losing/stale responses are visible and never become unrelated follow-up turns |
| Crash/reconnect/replay | Crash before/after event persistence, create, reply observation, remote admission and acknowledgement; restart and lost responses preserve stable IDs and produce no duplicate turn or lost tracked reply |
| Needs input/completed/failed | Correct event type and exact destination while phone is elsewhere/locked; combined done-and-question is one notice; no token-stream spam, recursive failure alerts, or stale approval reissues |
| Intended device delivery | Scope/device-routing entitlement verified; observed phone receipt distinguished from provider acceptance, web acceptance and simulator-only behavior; denied push permission produces actionable status |
| Cold/warm/locked handoff | Default tap opens exact SSHuv conversation after required unlock/authentication on signed installed builds, with no mandatory intermediate SHark inbox tap |
| Destination security | Reject wrong origin/path/version, malformed/oversized encoding, injected commands and untrusted hosts; URL contains no secret and never executes a turn/approval or takes terminal control |
| Stale/offline/absent app | Resolved request cannot be acted on; offline/missing conversation remains honest; app/association failure has safe fallback and retained inbox, not another conversation or public session details |
| Existing SHark behavior | Non-SSHuv taps, inline reply/approval actions, SecureStore retry, macOS responses, browser notice-only behavior and existing Watch restrictions remain intact |
| Host isolation and revocation | Host A cannot route to host B; changed/revoked token blocks the right operations; phone revocation stops new host actions; transcripts/credentials stay outside notification and diagnostic payloads |
| Rollback | Stop new integration, settle pending requests, retain outbox/mappings/config; old clients fall back safely and recovery shows any reply not yet admitted |

Record each result with app/agent/host versions and timestamp. No acceptance row is closed solely
because implementation source exists. For the **documentation-only refresh**, review the complete
diff, resolve referenced paths, check stale claims/contradictions and Markdown structure, and run
`git diff --check`; application tests and production acceptance are not implied by those checks.

## Rollback

- Phase 1 is independently reversible: restore the prior sharkctl expiry default and skill guidance;
  no server or persisted-data migration is involved.
- Before disabling a deployed broker, stop new completion hooks, inspect `sharkd status`, and use the
  queue controls to cancel every pending SHark interaction. Do not strand answerable prompts whose
  local route has been removed.
- `sharkd service uninstall` stops and removes only the user service definition. It preserves the
  protected broker config and SQLite database by default so rollback or forensic recovery remains
  possible. Credential or state deletion requires a separate explicit operator action.
- Re-enabling the last reviewed broker artifact against the preserved database resumes polling and
  state recovery. If the database is intentionally discarded, first cancel pending interactions;
  server enumeration cannot recover them.
- Broker token revocation is separate from service uninstall. Revoke it only after pending prompts
  are canceled or deliberately abandoned.
- Disable new SSHuv lifecycle producers/bridge writes before switching back to legacy hooks; ensure
  one active owner per agent request throughout the change. Retain unresolved conflicts and
  ambiguous admission records; do not replay them with new IDs.
- Roll back SHark's SSHuv forwarding independently to the existing inbox flow, preserving original
  URLs and durable content. This is a degraded fallback, not a successful one-tap v1 experience.
- Preserve opaque destination mappings for still-valid notifications and document retention before
  removal. Reverting app routing must not expose local session state through a web fallback.

## Risks and Constraints

- A provider accepting a push does not prove the notification was displayed or answered.
- An unqualified interaction can be accepted only by web push even though browsers cannot answer in
  v1. Blocking guidance and the broker therefore explicitly target reply-capable devices
  (registered iPhones and macOS companions).
- A completion reply may arrive while the target session is active, idle, closed, moved, or
  deleted.
- Starting a second Claude or Codex process against an active session may corrupt or race session
  state.
- Harness session identifiers and resume semantics are not uniform, are unverified from this
  repository, and may change independently.
- Free-text replies are user input and must never be interpolated into shell commands, paths, or
  executable configuration (consistent with `skills/shark/SKILL.md` Security Boundaries).
- The local broker introduces process supervision and durable state that must remain observable
  and recoverable without becoming a general workflow engine.
- `node:sqlite` raises the broker package's runtime floor to Node >=22.13.0 even though the wider
  repository permits older Node 22 releases. Host acceptance must use the exact executable that the
  generated service invokes and prove `node:sqlite` imports without an experimental flag; only
  the specifically observed SQLite experimental warning may be tolerated for that pinned runtime.
- The `Invalid device selection` replacement path pins a human-readable server error string rather
  than a machine code. An upstream Hark reword would be caught by the broker fixture and the
  `docs/upstream-delta.md` entry; until re-pinned, the failure mode is safe but degraded (terminal
  `rejected` with no payload replacement).
- Effectively-once delivery depends on each adapter proving durable `deliveryId` deduplication. An
  adapter that cannot prove it does not ship.
- Loss of the broker's local store strands pending interactions until they expire (≤ 24 h); they
  remain answerable on the user's devices but the answers become undeliverable. This is accepted in
  v1.
- Deferred questions default to 8 hours and can opt into at most 24 hours. The server rejects replies
  after expiry, so there is no separate late-response delivery path.

## Explicit Non-Goals

- A new SSHuv push backend or SSHuv-native app-aware push registration for v1; SHark branding is
  accepted. Server contract changes are excluded from the baseline and require an explicit
  evidence/approval gate, including any pending-interactions list or agent `correlationId` field.
- A public callback server for local agent sessions (the existing webhook callback mechanism stays
  webhook-only).
- Arbitrary command callbacks configured through SHark.
- Server-side knowledge of any harness.
- A new interaction type per harness.
- Automatic execution of instructions contained in reply text.
- Harnesses beyond the three named SSHuv v1 targets; OpenCode v1 compatibility. All three named
  agents remain required, not optional future integrations.
- An LLM classifier on completion events in the first release.
- Browser and Apple Watch free-text replies in v1.
- Publishing `packages/shark-broker/` as a public npm package in v1.
- Designing SSHuv's full UI/CommandDial, attachment or diff-review scope in the SHark repository.
- Public-user onboarding, team administration, billing, or unrelated production/backup repairs.

## Decisions

### Settled by repository evidence

- **Broker must poll with the creating token** — server scopes reads by `requesterTokenId`.
- **Multi-host isolation** — one token per host; server-side scoping prevents cross-consumption.
- **Blocking-ask expiry** — #33 derives omitted expiry for `--wait --timeout`, with explicit expiry
  precedence and clamps; 15 m remains the ordinary default. Pair flags for older installed clients.
- **Prompt/reply size budget** — 2,000 / 80 / 4,000 chars; truncation strategy defined above.
- **No server enumeration of pending interactions** — local store is the sole index.
- **Callbacks rejected** for this feature; mechanism acknowledged and left webhook-only.
- **Reply surfaces** — v1 free-text responses come from a registered iPhone or the macOS menu bar
  companion (added by PR #31 and adopted into this plan 2026-08-20); browser web push
  is notification-only and Apple Watch rejects text replies.

### Retained Design Decisions and Proposed SSHuv Extensions

The original deferred-reply decisions came from the 2026-08-20 grilling. SSHuv-specific mechanisms
below are planning extensions subject to the research gates; the user's confirmed product choices
are separately listed in the final section. This heading does not convert proposed mechanisms
into additional interview approvals.

- **Ownership and isolation** — the sibling broker package creates deferred interactions with a
  dedicated per-host token; CLI and daemon share the token through a mode-`0600` config file. Broker
  loading ignores ambient `HARK_TOKEN` and `HARK_API_URL`.
- **Packaging and lifecycle** — `packages/shark-broker/`, executable `sharkd`; primary Linux
  `shuvdev` uses a lingering-enabled systemd user service, while secondary macOS `shuvbot` uses a
  keep-alive LaunchAgent. Root-managed systemd mode is out of scope for v1.
- **Process split and store** — the CLI creates and registers; the daemon polls and delivers; both
  share built-in `node:sqlite` on Node >=22.13.0 in WAL mode with a busy timeout. No network RPC is
  added to the broker by default; the trusted SSHuv bridge needs a separately specified local seam.
- **Reply semantics** — completed-turn replies become new turns, queued as follow-up when busy.
  SSHuv active questions/approvals instead resolve the exact agent-native request through the
  shared mutation coordinator; this extends the original deferred-only scope.
- **Expiry** — 8-hour deferred default, 24-hour opt-in max, silent archive on expiry, no reminder.
- **Failure** — retain in a recovery queue and send one plain SHark failure notification.
- **Server scope** — preserve current contracts by default; any necessary exception requires an
  explicit decision. Local store loss remains a bounded deferred-reply risk, not a reason to omit
  backup/recovery or navigation-reference retention.
- **Content ownership** — the harness supplies summary and question; shared code only validates and
  truncates.
- **Harness order (revised for SSHuv)** — research all three required agents before freezing the
  seam, use OpenCode v2 for the first vertical proof, then complete Codex app-server and Claude CLI.
  The old shuvcode/shuvpi-first release ordering is superseded.
- **Blocking timeout** — when flag and stdin expiry are absent, sharkctl derives expiry from timeout,
  clamps it to 30 seconds through 24 hours (8 hours for an effective Live Activity, keyed on the
  flag-or-stdin-presentation boolean), and warns when the wait exceeds effective expiry. Polling is
  unchanged.
- **Completion detection** — explicit structured questions in v1; retain, but do not enable, a
  future deterministic heuristic evaluation.
- **Client reuse** — expose the supported `sharkctl/client` package subpath (plus `./package.json`);
  do not spawn the CLI per poll, import package source paths, or duplicate HTTP/error logic. Adding
  the `exports` map is an accepted published-package delta recorded in `docs/upstream-delta.md`;
  deep source imports were never supported.
- **Strict error classification** — the payload-replacement path requires HTTP 400 plus the exact
  `Invalid device selection` literal, pinned by a broker fixture and listed among the fork's
  compatibility names in `docs/upstream-delta.md`.
- **Plain completion path** — without `--question`, the summary truncates to the 2,000-character
  notification body limit; standalone fanout may include web push. SSHuv notices carry an exact
  destination, use the durable event outbox and target the intended iPhone(s). `accepted === 0`
  exits 7, there is no general agent-notification cancel API, and cross-shape idempotency reuse is
  a hard local conflict.
- **Crash-safe creation** — persist `creating` before the network call and reconcile by idempotent
  replay of the exact persisted create payload. A definitive non-idempotent `accepted === 0` enters
  durable server cancellation; an idempotent zero reconciles without unsafe cancellation.
- **Session probing** — registration, 15-minute pending cadence, and pre-delivery; only definitive
  `missing` cancels. Probe before creation; initial `missing` creates no interaction.
- **Idempotency** — `--idempotency-key` is required; hooks derive it from stable harness session and
  turn identifiers, and the broker never guesses one.
- **Targeting** — deferred interactions list and explicitly target active reply-capable devices
  (registered iPhones and macOS companions; revised 2026-08-20 after PR #31) so
  `accepted > 0` refers to a reply-capable surface.
- **Service safety** — install writes absolute executable paths, removes ambient token/API variables,
  and fails closed when Linux lingering is disabled.
- **Distribution** — the broker is a private workspace package in v1; its service points to the
  reviewed installed artifact.
- **Heuristic convention** — strict `Question for user:` final marker, offline fixtures, zero false
  positives before enablement.

### Confirmed in the SSHuv Wayfinder Interview, 2026-09-07

- **Audience and hosting** — personal v1, user-controlled host helpers/backend; reuse SHark rather
  than build a second notification infrastructure.
- **Notification identity** — SHark branding accepted; a normal tap must still open the exact
  SSHuv conversation. Two-tap inbox routing is not an approved scope reduction.
- **Agent scope** — OpenCode v2 only, Codex app-server, Claude CLI; native conversations, tool
  output, prompting, questions and approvals for all three in v1.
- **Desktop continuity** — discover/continue desktop-Herdr-started work without phone-launch
  requirements; feasibility and safe ownership must be proved per agent.
- **Herdr and lifecycle** — functional passthrough alongside native UI; needs-input, completion
  and failure notices while backgrounded/locked. Exact takeover and notification privacy policies
  remain open.
- **Change authorization** — this request refreshes, commits and pushes this plan only. It does not
  authorize implementation, dependency installs, hook migration, live notifications, deployment,
  restarts, backup repair, or altering the unrelated upstream-integration draft.
