# Codex app-server admission spike

Verdict: **blocked for a production reply-routing adapter**. The installed runtime supports useful native discovery, transcript paging, active request replay, and writer exclusion. It does not provide idempotent turn admission from `clientUserMessageId`, and a successful `turn/start` response is not a durable write barrier. The ordinary terminal launch also needs a verified host integration to make its live owner reachable.

This is an installed-runtime experiment dated September 7, 2026, using synthetic prompts, a local fake Responses API, and disposable local state. No production task, credential, notification, or paid model request was used. The tool approval example requests a synthetic `echo` and is declined; no model-requested command is executed. The PTY invokes the actual Codex terminal client; it is not a substitute terminal protocol or a broker implementation.

## Reproduce

From the repository workspace:

```sh
node docs/agent-reply-routing/research/codex-app-server/probe.mjs
node docs/agent-reply-routing/research/codex-app-server/verify-evidence.mjs
pnpm exec biome check docs/agent-reply-routing/research/codex-app-server
```

The probe requires the already installed macOS Codex binary, Node with built-in WebSocket, and the system Python PTY module. It installs no dependencies. `SHARK_PROBE_CODEX` can select another local Codex binary; that requires refreshing the version ledger and rerunning the evidence verifier. Each run creates a short `/tmp/shark-codex-probe-*` HOME and CODEX_HOME. A short path avoids macOS's Unix socket path limit. All app-server and terminal processes created by the probe are stopped. The synthetic state directories remain for inspection and are not part of the repository.

`evidence.json` records assertion values, source field paths, counts, and necessary request/response extracts. The full synthetic observations stay outside the repository; the compact file includes their local path and SHA-256. Observation names cited below refer to that raw file and are also present in the compact assertions' `source` fields. `summarize.mjs` deterministically builds the compact form. Disposable paths in the protocol data are replaced by `<RUNTIME>`. No production transcripts or system instructions are included. Model output tokens and messages are artificial; token counts cannot validate model behavior.

## Version and source ledger

| Surface | Observed version / digest |
| --- | --- |
| Desktop bundle `/Applications/ChatGPT.app` | `CFBundleShortVersionString = 26.901.51231` |
| Desktop embedded `Contents/Resources/codex` used by the probe | `codex-cli 0.153.4`; SHA-256 `a30ec314bbd0e3721632234d07db7c99855db3b9f1e32dbe8c791947f07e7629` |
| Homebrew npm package `@openai/codex` | `0.153.4`, Darwin ARM64 binary SHA-256 `b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3` |
| Protocol JSON generated independently by both binaries with `app-server generate-json-schema --experimental` | Identical SHA-256 `b06f77062369d481a59cc70720c12b89cb9dd49c385863923262102d3ad6c978` |
| Local execution runtime | Node `v26.5.0`, macOS ARM64 |

The two binaries report the same version and generate the same protocol schema but have different binary hashes. No source checkout or source commit was found in the installed npm package; this report does not invent a Git revision. Generated schema and TypeScript artifacts are cached outside the workspace at `/tmp/shark-codex-protocol-0.153.4-20260907/`; the independently generated desktop schema is at `/tmp/shark-codex-desktop-protocol-0.153.4-20260907/`. They are not vendored in this change.

Inspected type hashes from the installed generator:

- `v2/TurnStartParams.ts`: `85713b9158fa110ac20b63e0ec6f76faff8872402d62531f14172cfc5b1eacf7`
- `v2/ThreadQueueAddParams.ts`: `723482f57d633f9eb985f47932f2e444b0ef58f90220aa39d7cfac2d495ade02`
- `v2/ThreadResumeParams.ts`: `e4f64c88205dbba2bf87635d12b9c5803dd6f19b84b5682a71df7fdcf87862fb`

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) describes the corresponding JSON-RPC lifecycle, thread read/resume distinction, request responses, and experimental paging APIs. Runtime observations below take precedence over assumptions based on field names or documentation.

## Proven behavior

| Case | Native observation | Evidence name(s) |
| --- | --- | --- |
| Same-owner active discovery | A second client sees the loaded thread. `thread/resume` rejoins the same live turn and subscribes to completion. | `observer.loaded`, `observer.resumeActive`, `observer.completed` |
| Native transcript | `thread/read`, `thread/turns/list`, `thread/items/list`, and `thread/timeline/list` expose native messages and opaque history cursors. Cursors are history positions, not demonstrated durable notification cursors. | `readCompleted`, `turnsPage`, `itemsPage`, `timelinePage` |
| Native structured questions | All subscribers receive the same `item/tool/requestUserInput` request ID. A new client resuming during the request receives it again. The first answer resolves the request; a late conflicting answer does not create a second resolution. | `desktop.nativeQuestion`, `observer.nativeQuestion`, `reconnect.pendingRequests`, `resolutionEvents`, synthetic tool outputs in `modelRequest` |
| Native tool approvals | A native command-approval request is replayed to a reconnecting client and can be declined using its request ID. | `desktop.nativeApproval`, `approval_reconnect.request`, `readAfterApproval` |
| Writer exclusion | Another app-server process reading the same disk state reports `notLoaded`, but resume fails with `already has an active writer`. An attempted turn then fails because that process did not acquire the thread. | `otherProcess.readActiveOwner`, `otherProcess.resumeActiveOwner`, `otherProcess.turnStartActiveOwner`, `concurrentProcesses` |
| Restart correlation | A fully persisted message retains `userMessage.clientId` after abrupt server death. Both duplicate busy inputs remain discoverable. A queued submission retains its submission ID and `clientUserMessageId` before resume. | `restart.readBeforeResume`, `restart.queueBeforeResume`, `restart.itemsPage` |
| Real terminal origin, shared owner | A real TUI launched with `--remote` starts a native session. Another client discovers and rejoins it while active, observes completion, and starts a subsequent turn. The unique follow-up text appears in the TUI. | `terminal.start`, `terminal.discovered`, `terminal.resumeActive`, `terminal.followupVisible`, `terminal.readAfterFollowup` |

The remote TUI session reports native `source: vscode`, despite being an actual terminal process. Do not filter discovery to `sourceKinds: ["cli"]` or invent source from the process label. The terminal's initial user message also has `clientId: null`; only the explicitly correlated follow-up has a delivery ID.

## Admission failures and required treatment

1. **A client ID does not deduplicate.** Repeating a completed `turn/start` with the same `clientUserMessageId` creates a second turn. Repeating it while a turn is active adds the input twice to that active turn. Repeating `thread/queue/add` creates two distinct queue IDs and executes both. See `readAfterDuplicate`, `readAfterBusy`, `queueList`, and `restart.readBeforeResume`.
2. **`turn/start` is not idle-only admission.** While busy it steers the active turn, including a second client's input. It does not provide an expected-idle generation or revision precondition. `turn/steer` does have `expectedTurnId`; the stale ID probe fails correctly. See `busyTurnStartFromSecondClient` and `staleSteer`.
3. **Successful admission response precedes durable persistence.** For five independently seeded, pre-existing threads, the probe receives a new turn ID, immediately kills the app-server, then reads from a new process. The acknowledged delivery's client ID is absent in all five runs. These observations are `immediateAdmissionCrash`. A positive response alone cannot be committed as durable delivered state.
4. **Resume can cause work.** Resuming an unloaded thread with a durable queue automatically drains the queue. A following queue snapshot can be empty before the corresponding message becomes visible in a transcript read. See `restart.queueBeforeResume`, `restart.resume`, `restart.queueAfterResume`, and `restart.readAfterResume`. Do reconciliation reads before a resume mutation. Do not interpret an empty queue snapshot as safe retry evidence.
5. **Default terminal origin does not automatically expose the proxy socket.** In the clean-home default launch without `--remote`, the model turn starts but `codex app-server proxy` exits because `app-server-control/app-server-control.sock` does not exist. Another process can discover/read the disk record and is rejected by the active writer lock when it tries to resume. See `defaultTerminal.*`. The shared-owner `--remote` route works; automatic host integration for ordinary default launches and live desktop GUI tasks remains unproved.

The native writer lock excludes a second harness process; it does not impose an exclusive client within the owning app-server. Any connected client can initiate a turn. A broker-only lock therefore cannot serialize an unmodified desktop client's submissions or close the idle-to-active race. A shared admission authority or demonstrated native compare-and-admit primitive is still needed.

The default terminal's disk read from a different process labels the held live turn `interrupted` while that terminal is still running. Neither that reconstructed turn status nor `notLoaded` is authoritative evidence that the native owner is dead. Do not turn an inaccessible owner's disk projection into cancellation or permit an alternate writer.

## Positive reconciliation versus an unknown outcome

A broker may positively reconcile an ambiguous send when a read-only, correctly scoped native snapshot contains the exact delivery ID, destination thread ID, and expected content once. Persist the observed native turn/item ID and mark the input admitted without resubmission. A durable queue match proves queued admission and must not be interpreted as agent completion. Duplicate matches require a conflict state rather than selecting one silently. The snapshots must be paged far enough to cover the relevant durable history; absence from the first page proves nothing.

If the delivery ID is not observed, retain **unknown** and disable automatic retry. This includes a lost response, an acknowledged but not persisted turn, a queue-to-transcript gap, unreadable history, and an unavailable owner. A local broker's delivery table, arbitrary timeout, client ID, or server restart does not make retry safe. The crash probe proves that a positive acknowledgement can coexist with an absent durable item; it does not prove that every absent item was never admitted or cannot still arrive elsewhere.

For active questions and approvals, the current server request ID plus thread/turn/item identity scopes a live answer. Replayed requests and `serverRequest/resolved` can reconcile the same running owner. This spike did not prove a durable answer receipt API after harness restart, a cross-restart request-ID namespace, or lossless notification replay. If that receipt was not durably observed, preserve unknown rather than translating missing requests into cancellation or automatically answering again.

## Gates still open

- A production admission contract that covers the pre-persistence crash window and unmodified desktop client races, or an explicit product decision that those cases remain unknown with no automatic retry. This spike does not claim exactly-once admission.
- A one-time, verified Herdr/default-terminal and desktop GUI integration that exposes the actual native owner for every required desktop-origin session, without per-task tagging. A second process reading shared disk is insufficient for live requests.
- Durable reconciliation of answered requests and notification gaps across owner restart, including reliable runtime generation IDs.
- Real model/tool semantics, production host integration, phone delivery, and physical iPhone/Watch end-to-end behavior. Those were outside this credential-free local feasibility probe.

No broker schema, production Codex adapter, real task mutation, or deployment is included here.
