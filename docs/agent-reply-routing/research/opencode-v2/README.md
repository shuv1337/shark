# OpenCode v2 admission and discovery spike

Observed on **2026-09-07 America/Los_Angeles** (result timestamps are UTC).

**Verdict: partial native support; the required adapter is not release-ready.**
Durable prompt admission and replay after a lost response plus process crash pass
against the installed shuvcode binary. Request settlement does not have durable
restart reconciliation, and the installed server does not retain its advertised
session event log. Desktop-Herdr discovery, safe ownership on the actual host,
busy execution, complete transcript/tool streaming, and lifecycle recovery remain
open gates.

## Exact target and scope

- Installed command: `/Users/shuv/.bun/bin/shuvcode`, launching
  `/Users/shuv/.bun/install/global/node_modules/shuvcode-darwin-arm64/bin/shuvcode`.
- Observed version: `shuvcode v2.0.0-alpha-19`; exact binary SHA-256 is in
  `probe-result.json`.
- Matching [release](https://github.com/Latitudes-Dev/shuvcode/releases/tag/v2.0.0-alpha-19)
  points to `6829c0e589f73ed105a60b002b2535aed04847d3` and was published
  `2026-09-02T21:57:08Z`.
- The local `/Volumes/shuvbot-repos/shuvcode` checkout is older:
  `31e460ecde896d60378d54f4d3381c9df1681e4a`, dated 2026-08-01. It is not the
  installed runtime's contract. In particular, its `/question` and `/pending`
  routes differ from this installed release's `/form` and `/inbox` routes.
- `opencode` was not found on PATH. These results apply to this pinned shuvcode
  v2 fork, not every release named OpenCode v2.
- All mutations used disposable synthetic sessions in a fresh database/config
  beneath the research directory, removed on completion. No existing server,
  live credentials, production service, real notification, existing conversation,
  Herdr pane, dependency installation, or external model was used. The child ran
  under a macOS sandbox denying non-loopback networking. The optional execution
  attempt used a local fake model endpoint and did not reach that endpoint.

## Reproduction and evidence

From the isolated SHark workspace, with Node 22.13+ on macOS:

```sh
node docs/agent-reply-routing/research/opencode-v2/probe.mjs
node docs/agent-reply-routing/research/opencode-v2/probe.mjs --execution
```

The first command is the completed admission/request probe. The second reproduces
the unresolved synthetic execution attempt and exits nonzero. Neither starts a
model with real credentials. An optional absolute binary path can be supplied;
re-running against a different artifact produces new evidence, not an assertion
of compatibility.

- `probe-result.json`: installed-binary results, binary hash, isolation, and
  privacy-safe observations. `result: passed` means these bounded probe assertions
  passed, not the SSHuv acceptance matrix.
- `execution-probe-result.json`: failed busy/wake fixture, with native projected
  message types, event-log marker and empty persisted-event count. No transcript
  or credential dump is retained.
- `api-summary.json`: installed OpenAPI route names, descriptions, response
  statuses, and hash of the complete API document. Presence of a route alone is
  not a successful capability test.
- `source-evidence.json`: hashes and immutable URLs for matching release source.
  Raw source and the full OpenAPI document were inspected in a separate temporary
  cache, not added to the SHark workspace.

## Observed admission and request behavior

| Scenario | Installed-binary result | Meaning |
| --- | --- | --- |
| Disposable session created before another client lists | HTTP 200; observer finds the exact native session ID | API discovery works for a session created outside that observer; actual desktop-Herdr discovery remains untested |
| Missing session GET and prompt | HTTP 404 `SessionNotFoundError` | Definitive missing only from the authenticated authoritative endpoint; a transport failure is unknown |
| `prompt` with caller `msg_` ID, `delivery: queue`, `resume: false` | HTTP 200; one durable inbox item; session inactive | Accepted and queued, not executed |
| Exact retry | Same admission receipt, one inbox item | Caller-supplied message ID is the durable dedupe key |
| Changed text or delivery with the same message ID/session | HTTP 200 returning the first payload/delivery | Native API uses first-admission-wins; it does not reject altered text as a conflict |
| Same message ID in a different session | HTTP 409 `ConflictError` | Message ID namespace is wider than one session |
| Response suppressed by local proxy, then server SIGKILL | Client sees unknown; underlying admission was HTTP 200 | Real acknowledgement-loss boundary was exercised |
| Exact replay after restart | Same receipts; two distinct submitted IDs remain exactly two inbox items | Durable admission survives crash without duplicate queue entries |
| Two form replies | One HTTP 204, one HTTP 409 `FormAlreadySettledError`; terminal state identifies the winner | One controlled concurrent race passed; not a proof across arbitrary plugin delays or server crashes |
| Late form reply | HTTP 409 | Settled form cannot be answered again during retention |
| Two permission replies | One HTTP 204, one HTTP 404 `PermissionNotFoundError` | Request disappears after settlement; the endpoint cannot show the winning decision afterwards |
| Form state after SIGKILL/restart | Both an answered form and a pending form return 404 `FormNotFoundError` | Restart destroys authoritative form state; absence cannot establish whether a lost response was applied |
| Deleted session | DELETE 204 followed by GET 404 | Native deletion distinguished from a connection failure |

The exact prompt body is `{ id, text, metadata, delivery, resume }`; the response
is `{ data: { id, sessionID, timeCreated, type, payload, delivery } }`. Preserve
one unpredictable message ID and the exact outgoing payload durably before the
first attempt. Reject local key/payload conflicts. HTTP 200 alone must not be
reported as model completion; verify and retain the returned native receipt.
`resume: false` permits admission without execution. Normal prompt submission
schedules a process-local wake. Queued input is intended for the next idle
boundary; default `steer` can affect the running work. Those scheduling semantics
are source-backed but the execution probe below did not establish them live.

## Event replay is unavailable in the installed CLI configuration

`GET /api/event` is a volatile stream. The declared durable alternative is
`GET /api/experimental/session/:sessionID/log?after=N&follow=false|true`, with an
exclusive per-session aggregate sequence.

The controlled server returned only `log.synced`, even with `after=0`, while
session/inbox/message projections and sequence counters advanced. A read-only
check of the disposable database found **zero event rows**. The matching source
explains this result: `Bus.configured()` defaults `persist` to false. The server's
programmatic `ServerOptions.events.persist` can change it, but the CLI's
`server-process.ts` does not pass an `events` option. The installed `serve --help`,
CLI environment declarations and user configuration schema expose no persistence
flag. There is no verified supported installed CLI setting to enable it.

This requires a changed host runtime or a separately built programmatic server
wrapper plus fresh acceptance. Turning persistence on later cannot reconstruct
already missed lifecycle events. Projected transcript snapshots remain useful,
but they do not prove every completion/failure/request event was collected.

## Questions, permissions and ownership limits

Native questions use typed **forms**, not the historical question API. Forms
support string/number/integer/boolean/multiselect/external fields and conditional
visibility. Reply through `/api/session/:sessionID/form/:formID/reply` with
`{ answer: { fieldKey: value } }`; query `/state` for pending/answered/cancelled.
The matching implementation retains settled form state in a process-local cache
for ten minutes. Pending entries are also in memory. Form events are ephemeral.

Permissions use session-scoped list/get/reply, with `{ reply: once|always|reject,
message? }`. Pending requests are an in-memory map; successful reply removes the
entry. Permission events are ephemeral. A later 404 can mean answered elsewhere,
cancelled, or lost on restart; it is not a durable delivery acknowledgement.
Do not use `always` as a substitute for a one-request decision. A rejection can
reject other pending requests in the same session, so that scope must be visible
to the shared arbiter. These response routes do not accept a broker delivery ID
or a durable compare-and-set revision.

The shared-service client exposes read-only discovery through its protected
registration file plus health/version/PID checks. Its `ensure()` path may start
or replace a server and is unsuitable as an automatic missing/unknown recovery
action. Standalone TUI sessions use a private child server with an ephemeral
parent-held credential. The execution coordinator serializes by session inside
one server process; `/api/session/active` reports only that process's ownership.
An absent session there does not prove that another process is not running it.
No actual desktop-Herdr instance or cross-process owner transfer was tested.

## Remaining acceptance gates

- **Busy/wake/promoted retry: open.** The optional fake-model execution accepted
  and promoted its synthetic input into the transcript, but no model request
  reached the loopback fixture within ten seconds. No live execution success,
  busy queue ordering, promoted-input retry, or completion was claimed. The
  source supports these concepts; the failed fixture is not proof that the
  native capability itself is absent.
- **Durable event collection: blocked on host runtime.** Enable retained events
  through a reviewed supported host runtime and prove replay/cursor handling,
  including event collection while the phone is disconnected.
- **Approval/question crash reconciliation: unsupported by these native
  endpoints.** A broker can expose unknown/stale state and stop replaying, but
  cannot turn missing in-memory state into an accepted answer. A local lock does
  not close the remote acknowledgement/crash gap.
- **Desktop continuity and exclusive resume: open.** Prove actual desktop-Herdr
  conversations use the enrolled authoritative server, plus live and inactive
  access without spawning a competing server. Bind session identity separately
  from Herdr pane identity and server process generation.
- **Full native UI/lifecycle: open.** Validate paginated message history and tool
  updates, forms/permissions generated by actual agent work, reconnect,
  completed/failed classification, moved sessions, and cross-surface arbitration.

Safe implementation boundary: a pinned, capability-checked discovery/snapshot
client and durable admit-only queue transport can use these verified shapes.
The common broker schema and production OpenCode adapter must retain explicit
unknown/queued states and must not be marked complete from this spike.
