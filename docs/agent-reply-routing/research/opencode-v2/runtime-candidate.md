# Shuvcode runtime recovery candidate

The follow-up user request authorized shuvcode source fixes and disruptive
shuvcode testing. Work was isolated in
`/Volumes/shuvbot-repos/shuvcode-reply-recovery`, branch `reply-routing-recovery`,
based on alpha-19 source `6829c0e589f73ed105a60b002b2535aed04847d3`.
The primary shuvcode checkout, installed binary, and elected service were left
unchanged during candidate development. The changes subsequently merged in
[PR #364](https://github.com/Latitudes-Dev/shuvcode/pull/364), commit
`b133e340e359eeb8df6fc15bb3cff55d6a6c3b6f`, and were deployed by the user.
The 2026-09-08 [SHark arbitration proof](../../arbitration-prototype/README.md)
verifies the installed Mac artifact and running service, and exercises the
installed binary against SHark's actual interaction routes.

## Resolved source gaps

- The CLI now supports `OPENCODE_PERSIST_EVENTS=true`, including a persisted
  managed-service setting and explicit environment override. A compiled-binary
  test verifies exclusive cursor replay across `SIGKILL`. Retention is opt-in,
  starts when enabled, does not backfill, and ends when the session is deleted.
- Form and permission requests/outcomes now have durable SQLite receipts.
  A conditional pending-to-terminal update chooses the first reply before
  observers run. Permission `always` grants commit with the receipt.
- Reply bodies accept a bounded optional `responseID`. Exact request/ID/payload
  retries acknowledge the same stored answer after restart without repeating a
  side effect. Changed answers cannot replace the winner.
- Receipt reads expose whether this runtime owns a live pending callback. After
  process death, an unanswered request is explicitly unavailable; it is not
  silently reconstructed or automatically answered. Graceful shutdown retains
  cancellation. Terminal receipts are retained for seven days; after expiry,
  absence is unknown and must not trigger an automatic old-action retry.
- Busy/wake investigation found fixture errors rather than an execution bug.
  Correct AI SDK package selection and context limits produce exactly two
  serial model calls for a desktop prompt followed by an HTTP-queued prompt.

New additive endpoints:

```text
GET /api/session/:sessionID/form/:formID/receipt
GET /api/session/:sessionID/permission/:requestID/receipt
```

Receipts return request, state, available, optional response ID, and timestamps.
Exact session and Location ownership still apply, including MCP's temporary
`global` form owner. Existing pending list semantics do not autoload Locations.

An answer receipt proves admission, not successful model/tool continuation.
A crash between commit and callback resolution remains interrupted execution.
The existing no-startup-provider-replay policy is preserved. Native form and
permission events remain ephemeral; receipts reconcile known requests and live
pending inventories. The session event log is separately replayable when enabled.

## Verified candidate

Artifact: `/tmp/shuvcode-recovery-build/shuvcode-darwin-arm64/bin/shuvcode`

Version: `0.0.0-reply-routing-recovery-202609080357`

SHA-256: `b9c0ae94ca84b9e130b4f6ada94a35f544ea622016f189efccb5aeb8a3f64ba9`

The compiled candidate passes seven receipt/event tests with 50 assertions,
including managed configuration and forced restarts. It also passes 22 execution
assertions and 30 native TUI assertions. The real native TUI submits the first
prompt, renders a second client's follow-up completion, and answers a synthetic
question and permission request whose receipts reject late HTTP competitors.
There are exactly two loopback model calls, with no external provider or real
notification. The test session is seeded and explicitly selected in the TUI;
this is not a Herdr enrollment or phone acceptance claim.

The affected core/websearch tests pass 135 cases; MCP passes 57. The broad core
rerun passes 3,913 tests with 20 skipped using a filter excluding a confirmed
baseline tool-registry failure. That failure reproduces at the untouched base
SHA. Fifteen server policy/options/event/workerd tests and the pending-request
read test pass. Typechecks, generated public surfaces, targeted lint (no errors),
and the full macOS ARM64 build pass. Three unrelated OAuth-port tests could not
bind port 1455 because a Python process already owns it; it was not disturbed.

Reproduction scripts, compact evidence, and detailed limitations are in the
shuvcode worktree's `docs/research/reply-routing/README.md` and related files.

## Remaining gates

This closes the demonstrated source CLI replay and request-receipt gaps, and
provides a tested native TUI/HTTP cooperation path. The later Mac deployment is
verified in the linked arbitration proof; other-host activation and effective
event-retention settings need their own checks. These results do not provide complete preexisting event history,
prove Herdr transport, close Codex/Claude admission, implement the broker, or
complete signed SSHuv handoff. This Codex task is outside Herdr, so its focused
session was not inspected or controlled. All three adapters' original release
guarantees remain in force.
