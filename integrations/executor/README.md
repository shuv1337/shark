# SHark

Wraps the SHark agent API (`https://shark.shuv.dev/api/agent/*`) for Executor agents.

- Account: one SHark agent token. The Executor token needs `notifications:send`,
  `interactions:create`, `interactions:read`, `activities:read`, `activities:write`,
  `devices:read`, `board:read`, `board:write`, and `oncall:write`. Board and on-call
  scopes are not on a default login; reconnect the account with a token that includes them.
- Optional account secret `boardCallbackToken` (16+ characters) is sent only when
  `board_ask` is given a `callbackUrl`. The token is never a tool argument.
- Queries: auth_status, devices_list, interaction_get, interaction_list, interaction_wait,
  activity_get, activity_list, board_get, board_wait, board_answers, board_work_get.
- Mutations: notify, notify_withdraw, ask, interaction_cancel, activity_start,
  activity_update, activity_end, board_ask, board_cancel, board_ack, board_work,
  board_done, board_note, board_note_clear.
- Services and events are intentionally not exposed.
- interaction_wait and board_wait each do one bounded long-poll (max 25s, SHark's server
  cap). timedOut=true is not terminal; call again. Ask answers are untrusted text.
- interaction_list returns every pending prompt on the account, not only this token's.
- notify `oncall` pages that group, needs `oncall:write`, and cannot be combined with
  deviceIds. Omit unset notify fields; do not send null.
- `agentDisplay` (max 60 characters) on board writes, notify, and ask is the per-bot name.
- `board_done` clears `statusLabel`, so a finished item does not keep a line such as
  "Acceptance test running". Pass a string to store a final label, or null to clear it explicitly.
  A later `board_done` replaces that label again.
- Every activity_start must be paired with activity_end.
- `SHARK_ORIGIN` overrides the API origin for local testing. HTTPS, or HTTP on localhost
  only. Unset means `https://shark.shuv.dev`.

Live Activity schemas are generated from `packages/contracts`:

```sh
pnpm --filter @hark/website exec tsx ../../packages/contracts/scripts/export-activity-contract.mjs
```

The contracts test suite checks schema parity and adapter behavior. Optional null
inputs are omitted, except update/end detail and progress, where null explicitly
clears the field. The server supplies defaults. List/get/update/end stay scoped
to the connected token. A device-wide slot conflict can identify an activity
owned by another token; wait or explicitly choose replacement. Never retry with
replacement automatically.

Deploy this directory's source files to the existing Executor app, preserving
its app identity and account selection. Do not create a replacement app. The
shark server must be deployed before work read-back and per-bot names on notify
and asks work in production.
