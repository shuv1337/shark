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
  Infisical-fed secrets, exact-schema SQLite checkpoint validation, encrypted Restic snapshots,
  and operator promotion with no GitHub VM credential.

## Compatibility names kept intentionally

Do not casually rename `harkctl`, `HARK_*`, `@hark/*`, the `hark` config directory, SQLite names,
token prefixes and hash-domain strings, notification category IDs, `HarkAgentActivity`, webhook
routes, DTOs, migrations, or `Hark-Callbacks/1`. These are protocol or persistence identities, not
visible incomplete branding.

## Upstream review

Before importing upstream changes, fetch upstream, inspect commits and the full diff, resolve the
small brand/config layer deliberately, then rerun the automated baseline and physical-device smoke
tests. Never merge an upstream change directly into production.
