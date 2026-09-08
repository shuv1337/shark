# Permission bridge inventory

Observed 2026-09-07 on `shuvbot` and through the existing SSH route to `shuvdev`.
This was a read-only inspection of the current user's standard configuration paths and service
registrations. No hook was invoked, trusted, installed, removed, or migrated. Configuration values,
hook commands, credentials, and log contents were not retained.

| Surface | shuvbot | shuvdev |
| --- | --- | --- |
| `~/.claude/settings.json` | Present; one `PermissionRequest` hook, zero SHark command matches | Present; one `PermissionRequest` hook, zero SHark command matches |
| `~/.codex/hooks.json` | Present; one `PermissionRequest` hook, zero SHark command matches | Present; one `PermissionRequest` hook, zero SHark command matches |
| `~/.codex/config.toml` | Inline hook tables present; no SHark permission-command marker | Inline hook tables present; no SHark permission-command marker |
| Standard OpenCode V1 SHark plugin path | Absent | Absent |
| `dev.shuv.shark-permission-bridge` LaunchAgent | Plist absent; not loaded in this user's launchd domain | Not applicable |
| Standard SHark permission-bridge state directory | Absent | Not applicable |
| SHark-named systemd user services | Not applicable | Zero in both unit-file and loaded-unit queries; both queries succeeded |

The source installer uses `~/.config/opencode/plugin/shark-permissions-v1.js` for its V1 shim,
`~/Library/LaunchAgents/dev.shuv.shark-permission-bridge.plist` for its macOS service, and
`~/Library/Application Support/SHark/permission-bridge` for service state. Its existing OpenCode
installer supports macOS; this inventory does not imply a Linux installer exists.

SHark hook recognition searched the command plus structured arguments for
`permissions hook claude` or `permissions hook codex`. No private values were printed. This
establishes no standard SHark installation at the inspected locations, not global absence of a
bridge: project-local hooks, alternate configuration homes, wrappers with different command
spellings, container users, and unrelated services were not exhaustively inspected. Merely finding
a hook on disk also does not prove that a running agent has loaded or trusted it.

## Migration boundary

Existing non-SHark permission hooks and inline Codex definitions must remain intact. Before the
new coordinator is activated, inspect the exact enrolled agent process's effective configuration
and determine whether those hooks observe, transform, or answer the same native request. A new
bridge must not create a second independent response owner. Record the old effective configuration
privately for rollback and verify the merged configuration has one answer authority.

The [current installer](../../packages/sharkctl/src/permissions/install.mjs) already performs
targeted merging/removal and detects concurrent config changes. Its existing fixture tests remain
part of the passing CLI suite. New coexistence/migration fixtures still depend on the chosen native
owner and authenticated SSHuv coordinator; no migration has been declared complete.
