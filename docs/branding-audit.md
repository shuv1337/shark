# Branding audit

This file records the deliberate upstream and compatibility references left in
SHark v1 after the exhaustive source audit.

## Deliberate references

- `README.md` names and links the upstream Hark repository for attribution and
  records the imported commit.
- `skills/shark/SKILL.md` retains the upstream author in the PolyForm
  noncommercial license metadata.
- `docs/upstream-delta.md` names removed upstream systems so future merges can
  preserve the fork boundary.
- Tests mention `Hark Pro` and `Autumn` only to prove that paid-plan copy is
  absent and stale billing configuration is rejected.
- The `@hark/*` package scope, `harkctl`, `HARK_*` environment variables,
  database names, DTO route names, secure-storage prefix, cryptographic domain
  strings, `HarkAgentActivity`, and `Hark-Callbacks/1` remain protocol or
  migration compatibility identifiers as required by the rebrand plan.
- The Git `upstream` remote intentionally points at the original Hark
  repository.

## Removed defects

- Original bundle IDs, team IDs, domains, Expo project IDs, App Store IDs, and
  demo/store URLs are absent from runtime source and generated native
  configuration.
- Original teaser and notification-demo media were unreferenced and removed.
- Public marketing, pricing, billing-provider, Google-authentication, robots,
  sitemap, and teaser surfaces were removed.

The canonical customer-visible name is `SHark`, the origin is
`https://shark.shuv.dev`, and the canonical art is the Devil Phone asset
described in `brand-provenance.md`.
