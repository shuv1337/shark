# Agent reply routing implementation evidence

Work date: 2026-09-07 America/Los_Angeles. Source base: `faf3d9e4`, with the current SSHuv planning
changes captured before implementation. The implementation lives in the isolated Jujutsu workspace
`agent-reply-routing-20260907`. The plan's original guarantees remain requirements.

Follow-up 2026-09-08: the user deployed merged shuvcode PR #364. The
[SHark/shuvcode arbitration proof](arbitration-prototype/README.md) verifies the
installed Mac artifact and running service and passes 11 real-route/runtime
integration cases plus 21 prototype tests. It covers both active requests and a
deferred reply that executes once after queueing, response loss, and restart. The user then approved
staging a shuvcode-only broker while retaining all three agents as final release requirements.

## Completed source work

The private [broker package](../../packages/shark-broker/README.md) now implements `sharkd`, a
protected SQLite WAL outbox, fenced CLI/daemon access, exact create/reply recovery, token/origin
pinning, active-request arbitration, completion registration, recovery controls, service definitions,
and local JavaScript API v1. The shuvcode adapter pins session generation and Location and validates
native receipts before reporting admission. Other harnesses fail closed. Seven actual broker
SIGKILL boundaries and concurrent worker registration pass against local SHark routes and the
installed shuvcode binary. No broker service was installed or activated.

The `sharkctl/client` export now shares the CLI's original HTTP/error code with library consumers.
Its separate service configuration loader accepts only a bounded, regular, non-symlink mode-0600
file, a server-format token, and an HTTPS origin (or HTTP loopback for tests). Ambient token/API
overrides cannot replace that file's credentials. The interactive CLI keeps its prior precedence
and wire behavior. Package exports, import compatibility changes, and caller privacy responsibilities
are documented in `packages/sharkctl/README.md` and `docs/upstream-delta.md`.

The [iOS handoff candidate](ios-handoff.md) validates an explicitly configured HTTPS prefix and
opaque reference, forwards only default taps, preserves inline actions and durable inbox fallback,
and coalesces duplicate cold/listener callbacks. It is disabled by default. Neither an origin nor
a receiving signed SSHuv application has been configured by this task.

A [read-only permission-bridge inventory](permission-bridge-inventory.md) covers standard user
configuration and service registrations on `shuvbot` and `shuvdev`. Both have other permission hooks
to preserve. No standard SHark bridge was found at the inspected locations; effective per-session
configuration and coordinated migration remain open.

The [completion content reference prototype](completion-prototype/README.md) implements trimming,
summary-only truncation, exact question/separator limits, title/key validation, and Unicode-safe
budgeting against the actual shared contracts. It remains historical proof; the broker now owns its
production formatter and boundary fixtures. The prototype is not imported by runtime code.

## Harness gates

| Gate | Observed runtime/source | Evidence | Consequence |
| --- | --- | --- | --- |
| OpenCode v2 admission and event replay | Merged `b133e340`, installed Mac artifact and healthy elected service; historical alpha-19 baseline | [Baseline probe](research/opencode-v2/README.md), [runtime candidate](research/opencode-v2/runtime-candidate.md), [SHark integration proof](arbitration-prototype/README.md) | Active-response arbitration and deferred queued execution pass with response loss/restart. Effective host event retention, Linux activation, and Herdr acceptance remain open. |
| Codex native ownership and durable admission | `codex-cli 0.153.4` | [Probe report](research/codex-app-server/README.md) | Shared-owner native TUI access is possible; `clientUserMessageId` is correlation, not deduplication, and a turn acknowledgement can precede persistence. |
| Claude desktop continuity and coordinated input | Claude CLI `2.1.263`, SDK declarations `0.3.263` | [Probe report](research/claude-cli/README.md) | Structured headless control works, but the official background terminal cannot attach to that owner mode. Enrolled hooks/channels have not proved the complete ownership/admission contract. |
| Herdr passthrough | Read-only local source `0292d1053134941a8569f0e39d1260018416a354` | `docs/next/website/src/content/docs/cli-reference.mdx`, direct terminal attach section, in the Herdr repository | A controller/observer stream exists. No running user session was controlled and no phone passthrough result is claimed. |
| Signed SSHuv handoff | No receiving SSHuv app scaffold or selected HTTPS prefix at implementation start | [Candidate notes](ios-handoff.md) | The parser and local routing tests do not close cross-app physical acceptance. |

The probes use disposable local state and synthetic inputs. Read-only inventory retains only
sanitized schema/counts. Real model providers, existing user-session input, live SHark notifications,
production changes, and device installs were not used. Each report distinguishes actual runtime
behavior from source inspection and untested scenarios.

## Required contract decisions

These are concrete gaps for the common three-agent contract and final release. The 2026-09-08
sequencing approval permits the versioned shuvcode-only broker before Codex/Claude closure:

1. **OpenCode runtime:** the [tested source candidate](research/opencode-v2/runtime-candidate.md)
   now exposes event retention and durable form/permission receipts, including exact reply retries
   and explicit unavailable callbacks after restart. Its native TUI cooperates with a second HTTP
   client. The merged Mac artifact is installed and its running service is healthy. The SHark
   integration proof passes; verify effective host retention and finish Herdr acceptance before
   treating a complete adapter as deployed. Event collection has an explicit start boundary;
   historical gaps are not backfilled. The approved sequencing choice and remaining gates are recorded in the plan.
2. **Codex admission:** do not retry `turn/start` or queue insertion merely because the same client
   ID is supplied. A durable, exact readback match is positive reconciliation; absence is unknown.
   The plan already requires visible recovery without automatic ambiguous retries. The release
   gate still needs a stronger native admission boundary or a proven reconciliation strategy.
   Accepting unresolved delivery as sufficient for a completed adapter would change that guarantee.
3. **Claude owner:** prove a supported enrolled native-terminal and structured-input architecture,
   or explicitly decide whether to replace that desktop experience with a managed SDK owner and
   custom terminal interface. Merely starting headless sessions from the desktop does not prove
   continuation of existing native interactive sessions.
4. **SSHuv ownership and navigation:** the app's current planning brief selects direct access to
   the chosen Herdr pane, initially read-only when desktop-controlled, with explicit Take Control.
   Enrollment, transport, transfer/release mechanics, and receiving-app implementation remain open.
   Select a controlled HTTPS prefix and reference retention policy before enabling forwarding or
   publishing association. The app repository was inspected read-only; no application scaffold
   exists there yet.

The broker's server credential must continue to own its SHark interactions. It cannot impersonate
a mobile response token, and SHark's response compare-and-set is not proof of native agent admission.
No server contract or token boundary has been changed to evade these gates.

## Validation

The staged broker has 53 portable tests covering persistence, recovery, CLI/privacy, adapter receipts,
content limits, and service lifecycle fixtures; they pass on Node 26.5.0 and the minimum Node 22.13.0.
The opt-in installed-runtime suite now has 22 integration cases: the original 11 protocol scenarios,
six deferred broker crash/replay cases, four durable active-request races, and concurrent registration
plus cancellation recovery. [Sanitized broker evidence](broker-evidence.json) records exact versions,
artifact hashes, and outcome names. The native subprocess is loopback-sandboxed and push is mocked.

Full workspace validation passes **503 tests** (67 CLI, 53 broker, 31 contracts, 77 Expo,
275 website), typechecking/builds, lint, and brand checks. An isolated offline installation of the
private broker and matching CLI tarballs passes the exported API import and `sharkd --help` smoke.
The original completion and arbitration prototypes remain independent historical proof. Host service
activation, logout/reboot survival, real notification receipt, and signed-phone handoff are not tested
by these portable fixtures. Raw protocol/transcript caches are not committed.

These are source/fixture results. Phase 2, Phase 3, Phase 5 physical acceptance, and the personal
release are incomplete. No plan checkbox above marks an end-to-end gate complete.
