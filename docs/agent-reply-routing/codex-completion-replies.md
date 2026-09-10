# Codex completion replies

The SHark broker now accepts `harness: "codex"` for completion questions. A phone or macOS reply
is appended to the exact native Codex task through its existing app-server owner. Idle tasks
start immediately; busy tasks retain the reply in Codex's queue until the current turn ends.
This is completion-reply support. Native tool approvals, live questions, automatic lifecycle
collection, and automatic enrollment of desktop or terminal owners remain separate work.

## Connect a host

The owner must already expose Codex's **WebSocket-over-Unix** listener, as produced by
`codex app-server --listen unix:///absolute/private/owner.sock`. This is not the separate raw
`app-server-control` proxy socket. Its parent directory must be owned by the broker user and
mode `0700`; the socket must have the same owner and must not be group/world writable.

The broker only connects. It never launches Codex, modifies an existing desktop launch,
resumes an unloaded task, selects the most recent task, or opens another process against shared
Codex state. Existing native desktop/terminal sessions must already belong to that reachable
owner. An inaccessible, unloaded, read-only, ephemeral, moved, or mismatched task fails closed.
There is no claim here that stock desktop or default terminal launches automatically expose
this listener. Host enrollment must verify the actual owner before activating a completion hook.

A trusted host integration supplies a regular, singly linked, mode-`0600` session reference:

```json
{
  "version": 1,
  "harness": "codex",
  "sessionId": "11111111-1111-7111-8111-111111111111",
  "cwd": "/absolute/project",
  "adapterData": {
    "socketPath": "/absolute/private/owner.sock"
  }
}
```

Use the actual native task UUID. Registration checks the native task and pins its creation time
and working directory in the broker database. Neither the reference nor its host path is sent to
SHark's server or placed in the notification.

```sh
sharkd turn complete --summary "Implementation and checks finished." \
  --question "What should I work on next?" \
  --session-ref-file /absolute/private/codex-session.json \
  --idempotency-key stable-native-task-and-turn-id
```

The existing `sharkctl` authentication/client layer and `sharkd` service handle notification creation
and reply polling. The reply body is a JSON text input, never a command argument or shell program.
The adapter sends only `thread/queue/add`; it does not steer the active turn or alter its model,
working directory, approval policy, or sandbox configuration. The local JavaScript API uses the
same session reference and adapter routing.

## Delivery and recovery

Codex's `clientUserMessageId` correlates messages; it does **not** deduplicate submissions.
Before the first write, the adapter checks the queue and paged full history for an existing exact
match. The broker then durably records that a native send may have occurred. It writes only once.

A send acknowledgement alone is insufficient. An exact readback match for the task UUID,
delivery ID, and full text records a native queue or history receipt. `delivered` means observed
native admission, not successful model execution or completion. Duplicate matches or changed
text fail as conflicts. Incomplete history, an unavailable owner, and ambiguous transitions
cannot produce a positive receipt. Reads are bounded to 100 pages per collection, 100 entries
per page, 8 MiB per message, and a 20-second operation budget after connection.

If the broker crashes or loses the response after its durable barrier, it only reads on recovery.
An unresolved send enters `unknown`, retains the original reply, and creates one recovery notice.
Automatic polling does not resubmit it. `sharkd queue retry ID` performs read-only reconciliation
for these attempted Codex deliveries; absence remains unknown and never authorizes another send.
A crash between recording the attempt and writing to the socket may therefore require manual
recovery even when no reply reached Codex. This conservative ambiguity is intentional.

```sh
sharkd queue list
sharkd queue show LOCAL_ID
sharkd queue retry LOCAL_ID
```

Only `queue show` prints the retained reply and native receipt. Discard after manual review if the
item should no longer be tracked. The existing shuvcode adapter retains its verified idempotent
retry behavior. Codex live approval/question registration fails before creating an interaction.

## Validation

The portable adapter/broker tests cover exact session routing, input preservation, paged readback,
duplicates, partial history, ownership failures, the durable send barrier, broker restart,
read-only manual retry, and unsupported active requests. The optional installed-runtime tests
start a disposable native owner with a fake loopback Responses provider, fresh HOME/CODEX_HOME,
and mocked SHark delivery. They exercise idle execution, busy queueing, and broker recovery after
native admission. They do not use a real model provider, user task, notification, or device.

```sh
pnpm --filter @hark/shark-broker test
SHARK_CODEX_TEST_BINARY=/absolute/path/to/native/codex \
  node --test packages/shark-broker/test/codex-runtime.test.mjs
```

Verified on September 9, 2026 (America/Los_Angeles): 520 workspace tests, typechecking,
lint, and brand checks passed. The broker's 70 portable tests plus both installed-runtime
cases passed together, with no skips. The installed test binary reports `codex-cli 0.153.4`;
SHA-256 `c147aa90d34139599711fb568102ceefc6319ca1ac5cb6f4056ca46a1834edd9`.
The test host used Node `v26.5.0` on macOS ARM64. Minimum-version Node execution and
Linux native Codex execution were not part of this validation.

The [earlier admission spike](research/codex-app-server/README.md) remains valid: this adapter does
not create an exactly-once native admission primitive or close the complete three-agent release
contract. The [official app-server documentation](https://learn.chatgpt.com/docs/app-server)
describes initialization and native thread/history APIs. The installed-runtime tests verify the
experimental queue behavior used here. Production host enrollment and real phone acceptance
remain unverified by these tests.
