# Claude CLI feasibility record

Observed on 2026-09-07 America/Los_Angeles (2026-09-08 UTC). Scope: the Claude row of `PLAN-shark-agent-reply-routing.md`, including enrolled desktop/Herdr launches, existing live sessions, exact pending requests, and durable admission. This is research evidence, not an implemented adapter or a completed release gate.

**Result: structured CLI control is real; the complete native-terminal-plus-broker route is not proved.** The strongest concrete incompatibility is that Claude rejects `--bg` together with `--print` before creating a session. Its official background terminal attachment cannot attach to the process mode used by the structured SDK. One-time enrollment can add useful hooks and channels to native desktop launches, but the documented channel path lacks admission acknowledgements. No verified combination yet meets all the plan's ownership, request recovery, and durable delivery requirements.

## Pinned runtime and reproduced results

- Installed Claude Code: **2.1.263**. Binary SHA-256: `ef5d2909c8af49f31ab6d5487e90316777bc2fac170adfe8160716caa8aaf4f9`.
- Examined public `@anthropic-ai/claude-agent-sdk` **0.3.263** declarations. The tarball's SHA-512 integrity was verified against the pinned value in `probe.py`; it was read in memory, not installed or executed. Declaration hashes are in `probe-result.json`.
- `claude agents --json` exited 0 and discovered one live interactive session, currently idle. Only schema and aggregate counts were retained. No session identifiers, names, process IDs, working directories, or transcript content were retained.
- A fresh, isolated `--bare --print --input-format stream-json --output-format stream-json` process accepted two structured `initialize` requests. Reinitialization returned `pending_permission_requests: []` and `pending_user_dialog_requests: []`. This proves the handshake and empty snapshot shape, not recovery of an actual blocked request.
- An isolated `--bare --bg --print` attempt exited **1**, with the explicit background/print conflict and unattachable-session diagnostic. This matches the documented restriction. [Agent view: shell launch](https://code.claude.com/docs/en/agent-view#from-your-shell)
- The handshake sent **zero user messages**, inherited no credentials, used a synthetic key and loopback port 9 for its model endpoint, exited 0, and removed its temporary configuration directory. No model request, existing-session write, production request, or notification was issued.

Reproduce from this workspace:

```sh
python3 docs/agent-reply-routing/research/claude-cli/probe.py --handshake --inspect-sdk
```

Without optional flags, the script only reports CLI version/hash and sanitized active-session inventory. SDK inspection fetches the pinned public package; the handshake creates its own temporary child. The background-conflict check runs only for the exact reviewed binary hash, whose validator rejects the combination before worker creation. Raw account/session values and stderr are never saved.

## Capability evidence

| Requirement | Evidence | Status for the full adapter |
| --- | --- | --- |
| Discover desktop-started live conversations | Installed `agents --json` returned a live interactive row. | Verified inventory, not control ownership. |
| Native snapshot and event stream | SDK provides structured messages for its own process; session APIs provide saved message history. | Current desktop pending-request snapshot and authoritative observation lease unproved. |
| Active question/approval response | SDK callbacks carry native request identifiers; hooks can programmatically answer `AskUserQuestion`. | No live blocked-request round trip tested. |
| Native terminal and structured owner share one session | `--bg --print` is rejected as unattachable. | This wrapper architecture is incompatible. |
| Inactive continuation | Documented session resume exists. | Exclusive inactive resume and race behavior unproved. |
| Busy, missing, and ambiguous delivery | Inventory supplies state; channels can queue or silently drop notifications. | No authoritative full-path admission distinction proved. |
| Durable `deliveryId` deduplication and crash reconciliation | SDK has message UUIDs and request replay; no durable end-to-end result was exercised. | Unproved; no ambiguous retry is authorized by this evidence. |

### Discovery and terminal lane

Agent view exposes active interactive/background inventory with session identity, process status, and an optional waiting category. `claude attach <id>` is a native terminal connection to a background job; `logs` is terminal output. The shell command surface lists discovery, attach, logs, stop, respawn, and removal, but no structured send/answer endpoint. The explicit `--bg`/`--print` conflict applies to future enrolled desktop launches too. A successful inventory entry therefore cannot be treated as a native broker attachment. [Agent view](https://code.claude.com/docs/en/agent-view)

### Structured owner lane

The documented SDK streaming-input mode is a persistent process accepting sequential messages, interrupts, and permission callbacks. The CLI exposes stream-json input/output in print mode. This is a viable foundation for a broker-owned headless session, including one started from a desktop wrapper; it does not establish the official Claude terminal experience for that same process. [Streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [CLI reference](https://code.claude.com/docs/en/cli-usage)

In the pinned package, `CanUseTool` receives `requestId`, `toolUseID`, and an abort signal. `reinitialize()` can redispatch pending permission/dialog requests after a transport gap; its comments require idempotent callbacks per request ID. `SDKUserMessage` supports message UUIDs, but that fact alone proves no durable admission transaction. These declarations are useful adapter inputs, not successful crash or duplicate-delivery tests. [Pinned SDK package](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.263.tgz)

Saved-session APIs such as `listSessions`, `getSessionInfo`, and `getSessionMessages` support history discovery. Resume loads prior conversation into a process. Neither saved history nor a `resume` option establishes exclusive control over another already-running process. No existing transcript was opened to make this assessment. [SDK session management](https://code.claude.com/docs/en/agent-sdk/sessions)

### One-time native desktop enrollment

A wrapper that launches ordinary interactive Claude with an enrolled plugin can preserve native terminal use. Hooks provide lifecycle observation, tool-call inputs, and programmatic question answers: `PreToolUse` receives `tool_use_id`, and an `AskUserQuestion` response can return the original questions plus `answers` in `updatedInput`. `PermissionRequest` has no `tool_use_id`. Hook invocation lifetime supplies a local response channel, but persistence, cancellation, terminal competition, timeout, and restart recovery need actual proof. `defer` is restricted to print mode and a single tool call, so it cannot solve the interactive native-session requirement. [Hooks reference](https://code.claude.com/docs/en/hooks)

Channels are another documented enrollment point. They support tool-approval relay by a native request ID, with the first local/remote answer winning. Ordinary channel events have **no acknowledgement**: transport write completion is not processing, blocked/unregistered channels can drop events silently, and events arriving while busy may be grouped into the next turn. This prevents treating a channel send as the broker's durable admission receipt. No documented channel API examined supplies a complete pending-question snapshot, ownership lease, or crash-safe delivery-ID reconciliation. [Channels reference](https://code.claude.com/docs/en/channels-reference)

Custom channels currently use a development flag or an effective allowlist, with organization policy still applying. No enrollment, policy change, or development-mode acceptance was performed. [Channels availability](https://code.claude.com/docs/en/channels)

**Assessment:** native desktop enrollment is a plausible partial integration, not disproved generally. It requires additional verified admission/ownership machinery before it can meet this plan. Starting a headless process from Herdr would avoid phone-only creation, but replacing the native Claude terminal with a custom SDK renderer would change the product experience; it is not a transparent implementation of `claude attach`.

### Other investigated routes

- **Cross-session messaging:** a documented local inbox accepts peer text under inbound controls; rate limits, held messages, short-window repeat suppression, and bounded queues apply. These are not exact pending-question/approval responses or proven durable delivery IDs. We did not connect to any live inbox or use a private protocol. [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- **Remote Control:** it preserves a running local session while Claude's web/mobile clients connect through Anthropic infrastructure. That establishes the first-party product, not a self-hosted SHark-native local API. No account changes or Remote Control activation occurred. [Remote Control](https://code.claude.com/docs/en/remote-control)
- **SDK `/bridge` and `/browser`:** the pinned bridge declarations expose cloud `cse_*` sessions, worker JWTs, server worker epochs, and SSE reconnect cursors. The bridge is explicitly alpha; credential minting advances the cloud worker epoch. The browser export consumes SSE/WebSocket transports. Neither declaration specifies an adapter into a local native interactive process. We did not mint credentials or take over a worker. [Pinned SDK package](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.263.tgz)

## Required next evidence

The Claude release gate stays open. Before freezing the broker seam or declaring this adapter complete, demonstrate a supported enrolled desktop session with native terminal use and a single coordinated input owner, then run exact question/approval response, stale-response cancellation, busy/missing classification, repeated delivery, lost receipt, owner crash, reconnect, and inactive-resume race tests against that route. Preserve unresolved ambiguous outcomes; do not replay them through a new process or identity.

The remaining gap is not fixed by funding a model prompt alone: the reviewed interfaces first need a supported ownership/admission architecture. A new upstream native control interface, a proved enrolled-hook admission design, or an explicit product decision about a custom SDK terminal could change the conclusion. None is assumed here.
