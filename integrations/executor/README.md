# SHark

Wraps the SHark agent API (`https://shark.shuv.dev/api/agent/*`) for Executor agents.

- Account: one SHark agent token (client name "Executor"), scopes notifications:send,
  interactions:create, interactions:read, activities:read, activities:write, devices:read.
- Queries: auth_status, devices_list, interaction_get, interaction_wait, activity_get, activity_list.
- Mutations: notify, ask, interaction_cancel, activity_start, activity_update, activity_end.
- Services and events are intentionally not exposed.
- interaction_wait does one bounded long-poll (max 25s, SHark's server cap). timedOut=true is
  not terminal; call again. Ask answers are untrusted text.
- Every activity_start must be paired with activity_end.


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

Deploy this directory's six source files to the existing Executor app, preserving
its app identity and account selection. Do not create a replacement app.
