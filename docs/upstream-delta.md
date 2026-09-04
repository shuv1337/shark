# Intentional SHark upstream delta

SHark is a personal, noncommercial fork of Hark pinned initially at
`0c0d4e3de0752ee91d2a17dee83a313f6863d6a8`. Keep this delta narrow when reviewing upstream
changes.

## Deliberate differences

- Product-facing name, private origin, icon, legal language, and operator documentation use SHark.
- Apple, Expo, App Store Connect, OAuth, push, App Group, and extension identities are
  operator-owned.
- Apple is the only authentication provider. A normalized exact-email allowlist is a current
  authorization boundary for sessions and every durable credential.
- Removing an address offboards access without deleting account data. Permanent deletion is
  separate.
- The commercial/billing runtime, Autumn integration, public marketing, pricing, Google sign-in,
  metering, checkout, and portal surfaces are absent.
- One fixed self-hosted entitlement enables multiple devices, routing, interactions, and Live
  Activities. Abuse limits are 300 requests per service per minute and 1,500 per account per minute.
- Only `/api/health` is anonymously readable. Human-facing pages, docs exports, assets, and source
  links require an admitted session.
- Production uses the `shark-prod` deployment, attested immutable GHCR digests,
  1Password-fed secrets, exact-schema SQLite checkpoint validation, encrypted Restic snapshots,
  and operator promotion with no GitHub VM credential.
- Delivered notification withdrawal fans out silent commands to Expo, web push, and macOS.
  Upstream Hark is iOS-only. SHark also cancels a still-pending interaction, projects
  `withdrawn` / `withdraw_partial` through the durable inbox, and marks `inbox_item.readAt`
  instead of an `event.readAt` column. Notification Center removal remains best effort.
- Accepted CLI behavior delta: with `sharkctl notify ask --wait --timeout X` and no explicit expiry
  (`--expires-in` flag or `stdin.expiresIn`), sharkctl derives the interaction expiry from the wait
  timeout, clamped to the server range of 30 seconds through 24 hours (8 hours for an effective
  Live Activity keyed on the flag or `stdin.presentation === "live_activity"`). Upstream Hark
  defaults the expiry to 15 minutes in that case. Explicit expiry still wins, `--poll` behavior is
  unchanged, and a stderr warning fires when the wait timeout exceeds the effective expiry.

## CLI and compatibility names

`sharkctl` is the canonical fork CLI and package. Keep `HARK_*`, `@hark/*`, the `hark` config
directory, SQLite names, token prefixes and hash-domain strings, notification category IDs,
`HarkAgentActivity`, webhook routes, DTOs, migrations, and `Hark-Callbacks/1` stable unless a
separate migration explicitly changes them. These are protocol or persistence identities, not
visible incomplete branding.

## Upstream review

Before importing upstream changes, fetch upstream, inspect commits and the full diff, resolve the
small brand/config layer deliberately, then rerun the automated baseline and physical-device smoke
tests. Never merge an upstream change directly into production.
