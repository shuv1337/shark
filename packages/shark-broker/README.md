# SHark reply broker

`@hark/shark-broker` is a private host package with the `sharkd` executable and a version-1 local
JavaScript API. It persists completion notices, deferred questions, native active-request mappings,
reply delivery intents, and recovery state before remote mutations. It shares `sharkctl/client`;
SHark's server API and token boundaries are unchanged.

This broker supports **shuvcode/OpenCode v2** and **Codex completion replies**.
[Codex setup and recovery](../../docs/agent-reply-routing/codex-completion-replies.md) requires an
existing reachable native owner and preserves uncertain sends without resubmitting them. Codex
active requests and Claude references fail closed. All three native agents, lifecycle collection, Herdr, SSHuv transport,
and signed phone handoff remain required for the final SSHuv release. No service is installed by
building or importing this package. The [evidence ledger](../../docs/agent-reply-routing/README.md)
separates local verification from deployment and physical acceptance.

## Runtime and configuration

Use Node **22.13.0 or newer**, with built-in `node:sqlite`; no experimental runtime flag is needed.
The package is private and installed from reviewed workspace artifacts, together with the matching
`sharkctl` artifact that exports `sharkctl/client`. It is not published to public npm. Build and test
from the workspace with `pnpm --filter @hark/shark-broker build` and `pnpm --filter @hark/shark-broker test`.

Default paths:

- Configuration: `${XDG_CONFIG_HOME:-~/.config}/shark-broker/hark-config.json`.
- Database: `${XDG_STATE_HOME:-~/.local/state}/shark-broker/broker.sqlite`.

Use an absolute `--config` or `--database` to override either path. Provision a dedicated per-host
SHark token through the existing browser authorization flow, explicitly requesting only
`notifications:send`, `interactions:create`, `interactions:read`, and `devices:read`:

```sh
BROKER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/shark-broker"
install -d -m 700 "$BROKER_DIR"
env -u HARK_TOKEN -u HARK_API_URL \
  HARK_CONFIG="$BROKER_DIR/hark-config.json" \
  sharkctl auth login --client-name "SHark broker $HOSTNAME" \
  --scope notifications:send --scope interactions:create \
  --scope interactions:read --scope devices:read
```

This setup command is for an operator-authorized host rollout. Keep config/session-reference/native
credential files regular, singly linked, owner-readable mode `0600`; the database directory must be
mode `0700` and database mode `0600`. The config contains `apiUrl` and `token`. HTTPS is required,
except HTTP loopback for local fixtures. Never put tokens in command arguments or service definitions.
Ambient `HARK_TOKEN` and `HARK_API_URL` cannot override the file; a conflicting `HARK_CONFIG` fails.
Each registration pins the authenticated creator token ID and API origin. Changing the credential
blocks its old work rather than replaying under another owner. Restore that identity to reconcile it.

## Completion and active requests

```sh
sharkd turn complete --summary "Implementation and checks finished." \
  --question "What should I work on next?" \
  --session-ref-file /absolute/private/session.json \
  --idempotency-key stable-native-session-and-turn-id
```

The command returns after durable registration and creation, without waiting for a reply. It prints
only the local ID, state, remote interaction/notification ID when known, and exit code. Without
`--question`, it sends one plain completion notice and needs no session reference. With a question,
it explicitly selects at most 50 active iOS/macOS reply-capable devices, excluding web subscriptions.
The deferred expiry defaults to eight hours, with `--expires-in` accepting 30 seconds through 24 hours.
A summary is truncated to the 2,000-character budget; the question and 80-character title are validated.
The normalized caller-provided key is required and cannot be reused for changed content or kind.

`--stdin` accepts at most 64 KiB of JSON with `summary`, `question`, `title`, `idempotencyKey`,
`session`, and `expiresInSeconds`; explicit command flags win. A trusted host integration provides the
session reference, never an untrusted notification payload:

```json
{
  "version": 1,
  "harness": "opencode-v2",
  "sessionId": "ses_synthetic_example",
  "cwd": "/absolute/project",
  "adapterData": {
    "serverUrl": "http://127.0.0.1:4096",
    "authFile": "/absolute/private/native-service.json"
  }
}
```

`authFile` is the native service's protected JSON credential file containing its `password`; it is
separate from the SHark token file. `adapterData.workspaceID` is required when the native Location has
one. Registration verifies and pins the native session creation generation and Location. Missing,
moved, or inaccessible sessions do not cause a competing process to start. No local session details
are included in SHark create payloads.

For a verified pending native request:

```sh
sharkd request register --session-ref-file /absolute/private/session.json \
  --kind form --request-id frm_synthetic_example --prompt "Choose the next step" \
  --idempotency-key stable-native-request-and-revision-id
```

Active registrations currently map one unconstrained string or boolean field to SHark reply/yes-no,
and permission requests to once-only approval or rejection. Unsupported form shapes fail. The trusted
caller supplies the bounded public prompt; tool arguments and transcripts must stay on the host.
Receipts bind the entire native request and response. The native winner is authoritative: a late SHark
reply becomes `superseded` or `stale`, with its losing content retained, and never becomes a new turn.
Pending SHark prompts are canceled when the native request is already resolved. Unknown native state
preserves the prompt. Accepted means native admission; it does not promise tool/model completion.

Deferred replies use a stable native `msg_` ID and structured queue input. Exact retries are safe for
the verified shuvcode runtime even after response loss. Shell syntax in the reply remains text.
Native HTTP 200 is checked against the full input receipt; changed payloads are conflicts.

## Daemon, recovery, and retention

`sharkd run` polls persisted work; `run --once` performs one pass. Deferred polls use 45 seconds with
10% jitter, active requests two seconds, and pending deferred session probes fifteen minutes.
Network failures back off to fifteen minutes. For shuvcode, native admission uncertainty retries with the same
persisted input after 5 seconds, 30 seconds, 2 minutes, 10 minutes, and 1 hour, then enters `failed` and
atomically enqueues one plain recovery notice. Failure notices do not recursively generate notices.

SQLite uses WAL, full synchronization, a five-second busy timeout, transactional migrations, and
60-second fenced item leases shared by CLI and daemon. A killed worker's lease may take a minute to
expire. Exact create payloads survive restart. An initial definitive zero-provider acceptance is
canceled durably; zero from an idempotent replay is reconciled without unsafe cancellation. Only HTTP
400 with the exact `Invalid device selection` error permits re-registration with refreshed devices.

```sh
sharkd status
sharkd queue list
sharkd queue show LOCAL_ID
sharkd queue retry LOCAL_ID
sharkd queue discard LOCAL_ID
```

Only `queue show` prints protected stored content. Attempted Codex sends use read-only reconciliation
on retry and remain unknown when no exact receipt is found. Retry preserves the input/key/owner; a rejected
registration requires the original registration command, not a replacement intent. Discard reconciles
and cancels still-answerable interactions first; an uncertain outcome stays tracked. Terminal payloads
are removed after seven days. Hashed retired-key tombstones remain to prevent delayed duplicate
registration. Failed, rejected, conflicting, and unknown work remain until operator recovery/discard.
Back up the database through a SQLite-consistent method, including its WAL; copying only the main
file while running can lose recent work. There is no SHark list endpoint to reconstruct a lost index.

Exit codes: `0` registered/settled, `1` conflict or permanent failure, `2` invalid input/unsupported
harness, `3` protected configuration/auth/scopes, `4` missing or terminal queue item/session,
`6` pending recovery/network/health uncertainty, `7` no reply-capable provider acceptance. Inspect
`state` to distinguish delivery, cancellation, supersession, and other terminal results.

## Service lifecycle

`sharkd service install|status|restart|uninstall` manages a per-user service using absolute Node,
entrypoint, config, and database paths. It verifies the Node SQLite runtime, removes ambient SHark
credential overrides, preserves unknown service files, and requires a fresh instance heartbeat within
20 seconds after install/restart. Health also checks manager PID, executable, entrypoint, and a heartbeat
no older than 90 seconds. An idle daemon still refreshes its heartbeat. Status reports last successful
poll, redacted last error class, and counts without reply text.

Linux uses `~/.config/systemd/user/sharkd.service`. Install refuses disabled lingering and prints the
one-time `loginctl enable-linger USER` command; it does not run sudo. macOS uses the keep-alive
`~/Library/LaunchAgents/dev.shuv.shark.broker.plist`. Uninstall removes only the owned service,
preserving configuration and state. Stop new producers and settle pending work before operational
rollback. Host logout/reboot survival and actual service-manager activation remain rollout checks;
portable tests exercise definitions and lifecycle behavior through synthetic command fixtures.

## Trusted local API

```js
import { openBroker } from "@hark/shark-broker";
const broker = await openBroker({ configPath: "/private/config.json", databasePath: "/private/state/broker.sqlite" });
try {
  await broker.complete({ summary: "Finished", idempotencyKey: "stable-turn-id" });
} finally {
  broker.close();
}
```

The API also exposes `registerActive`, `poll`, `retry`, `discard`, and content-free `list`. It is a
trusted in-process seam with no network listener, mobile credential, or enrollment policy. Automatic
native event/cursor collection, host-to-phone authentication, opaque navigation references, legacy
hook migration, and other-agent adapters are not implemented by this slice. Existing lifecycle hooks
must not be replaced until the integration establishes a single producer/response owner.
