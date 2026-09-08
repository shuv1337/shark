# SHark/shuvcode reply arbitration proof

Observed 2026-09-08. Historical protocol proof, followed by the separately approved
[durable broker stage](../../../packages/shark-broker/README.md). This prototype remains a research implementation of the Phase 2 cross-surface
and deferred-admission boundary. It does not create the shared broker package,
freeze its database schema, install a daemon, or satisfy the other agents' gates.

## Installed artifact and running service

[Shuvcode PR #364](https://github.com/Latitudes-Dev/shuvcode/pull/364) merged into
`integration-v2` at `b133e340e359eeb8df6fc15bb3cff55d6a6c3b6f`.
The active local `shuvcode` command resolves to
`/Users/shuv/.local/lib/shuvcode/local-b133e340/shuvcode`, reporting
`0.0.0-latest-b133e340`, SHA-256
`f540afa9dcc215af828a3e22961ae9de8001dbf1f984de8d4d9958e96b7f253c`.
Read-only `/api/health` on the elected loopback service reports that same version,
healthy, PID 54287. This is local Mac evidence; it is not a fresh Linux-host check.

The saved local service configuration has no `OPENCODE_PERSIST_EVENTS` setting.
The process environment was not inspected, so effective retention is not claimed.
Verify and enable retention on participating services before relying on event
catch-up. It does not backfill prior history. This task did not restart or change
the elected service.

The old global package directory still contains alpha-19. An initial test against
that path correctly failed all receipt lookups with 404. The probe requires an
explicit artifact path to avoid silently testing that obsolete copy.

## Proven behavior

The optional integration suite runs SHark's real Hono routes, authentication/token
scope logic, migrated SQLite database, and exported HTTP client against a real
compiled shuvcode subprocess. Auth session discovery and push transports are
fixtures. The only registered device is synthetic iOS. A separate test client
submits the phone response through the existing device/digest route; the creator
token only creates, reads, and cancels interactions.

The native process uses a fresh private HOME/config/database, synthetic credentials,
an explicit Location, and a macOS sandbox that denies non-loopback networking. A
loopback model returns deterministic text and cannot call tools. Native diagnostic
output and model request bodies are discarded. All child servers and temporary
state are removed at teardown. No real notification, external model call, shell
tool execution, device install, or user-session mutation occurs.

Eleven integration scenarios pass:

- A deferred SHark text reply queues behind an independently submitted desktop
  input, reaches the original native transcript, and completes with exactly two
  model requests total. A lost admission response and process restart preserve
  the input ID and produce no extra model request or user message. Changed text
  under that ID is classified as a conflict even though native HTTP returns 200.
- A stored phone answer resolves a live native form once; exact reconciliation
  after acceptance makes no second POST.
- Desktop-first resolution cancels the outstanding SHark interaction.
- A desktop answer that wins between receipt read and reply POST supersedes the
  already stored SHark answer. It never turns that answer into a new prompt.
- A reply POST whose acknowledgement is lost is reconciled from its exact receipt.
- A stored approval maps to `once`; a late native denial cannot replace it.
- A desktop denial supersedes an approval already stored in SHark.
- A phone response racing SHark cancellation remains recorded and is flagged as
  conflicting with the native winner.
- Missing native receipt state stays unknown, preserving the SHark interaction
  without posting input or treating a 404 receipt as definitive session deletion.
- Simultaneous exact response retries converge on one native answer.
- After SIGKILL, an answered receipt reconciles without a new POST; a previously
  pending callback is unavailable and remains a visible unknown outcome.

Twenty-one fast prototype tests separately cover malformed/readback states,
request digest changes, ID/payload conflicts, same-answer/different-ID precedence,
transport uncertainty, cancellation races, and structured input. These fixtures
do not replace the installed-runtime results.

## Contract established by the proof

`coordinator.mjs` operates on a trusted native request binding: exact session ID,
request ID, kind, Location-bound transport, canonical SHA-256 request digest, and
an opaque response ID bound to the full response payload. The caller must persist
that intent before mutation; this prototype has no durable store. A future host
bridge must validate its bounded input and authenticate the caller before invoking
it. The test maps a single string form and once-only approval; arbitrary form
layouts and broader permission scopes are not silently mapped to these shapes.

The authoritative native receipt determines the result:

| Native observation | Result | SHark convergence |
| --- | --- | --- |
| Exact response ID, full answer, and request binding | `accepted` | Preserve stored reply; cancel a still-pending interaction |
| Another response won, even with identical answer text | `superseded` | Cancel pending; retain/flag an already stored losing answer |
| Request changed or was cancelled | `stale` | Cancel pending; never answer a reissued request |
| Missing/malformed receipt, unavailable callback, or unresolved transport | `unknown` | Keep tracked state and avoid cancellation or blind reissue |

`accepted` means native response admission, not model/tool completion. A crash
after receipt commit can interrupt continuation. SHark may truthfully remain
`replied` or `approved` when the agent rejected the late response; the host's
correlation record and SSHuv UI must show the superseded outcome separately.
There is no creator-token route to rewrite that answer or impersonate the phone.
Cancellation does not promise removal from Notification Center.

`deferred.mjs` is deliberately shuvcode-specific. It submits structured text with
a stable `msg_` ID and queue delivery, verifies the returned session/input identity
and text, and distinguishes accepted, conflict, missing, and unknown. The durable
caller may retry an ambiguous submission using the exact persisted ID/payload
because native prompt deduplication was demonstrated. This guarantee must not be
copied to Codex or Claude, whose admission boundaries differ.

The staged broker now durably retains losing input, cleanup work, response IDs,
and exact payloads across its own crash. The original eleven scenarios below use
this prototype; eleven additional scenarios in the same integration file exercise
the broker package, including seven SIGKILL boundaries and concurrent creation. The deferred scenario starts via
an independent HTTP client; earlier native TUI cooperation evidence remains in
the [runtime report](../research/opencode-v2/runtime-candidate.md). Herdr and
physical-phone acceptance remain separate.

## Reproduce

From the SHark workspace root:

```sh
node --test docs/agent-reply-routing/arbitration-prototype/*.test.mjs
SHUV_ARBITRATION_BINARY=/absolute/path/to/reviewed/shuvcode \
  pnpm --filter @hark/website exec vitest run --config vitest.shuvcode.config.mjs
```

The integration suite is opt-in and fails if the artifact path is missing. It
does not run from the normal portable `pnpm test`. It emits only the binary
version/hash, isolation description, and assertion results. Full repository
validation is recorded in the [current evidence ledger](../README.md).

## Approved sequencing, 2026-09-08

The user approved a shuvcode-only reference broker with durable creation/replay, token pinning,
delivery IDs, recovery commands, and the proven admission semantics above. It now lives in
`packages/shark-broker/`; runtime code does not import these research prototypes. Codex and Claude
remain unsupported by the staged broker, and all three agents remain required for SSHuv v1.
Native lifecycle collection, effective host retention, Herdr and signed handoff acceptance, and
host rollout are still open. This approval changes implementation order, not the release definition.
