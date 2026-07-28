# SHark v1 Execution Plan

The detailed implementation plan at `../../PLAN-shark-minimal-rebrand-self-host.md` is authoritative. Execute its phases in order and use the confirmed handoff at `../../HANDOFF-shark-grilling-mac-ios.md` to resolve scope questions.

## 1. Safe branded source

Complete Phases 0–3: preserve licensing and attribution, establish the minimal brand layer, recover and deterministically generate the approved Devil Phone assets, remove public/paid/Google surfaces, implement fixed self-hosted entitlements, and enforce fail-closed Apple admission across every credential class.

Verification: run the plan's branding and anonymous-surface audits plus the full typecheck, test, lint, and production build baseline. Add focused tests for environment normalization, entitlement behavior, exact-email admission, credential revocation, and offboarding.

## 2. Operator-owned iOS identity

Complete Phase 4: create and wire the operator-owned Apple, Expo, App Store Connect, push, App Group, extension, and OAuth identities. Generate every test build with Sqim; use XcodeBuildMCP only to inspect already-built artifacts. Use EAS only for the final internal-TestFlight artifact.

Verification: audit generated native configuration and signed entitlements, verify the Sqim install page and artifact hashes, and complete the two-iPhone acceptance matrix.

## 3. Recoverable production service

Complete Phase 5: provision `shark-prod`, configure exe.dev and Cloudflare DNS, implement the safe health/readiness boundary, create 1Password-backed secret delivery with disjoint application and backup vault access, implement WAL-safe Restic backups, publish attested immutable images from GitHub without VM credentials, and promote an exact digest through the operator's existing exe.dev identity.

Verification: prove TLS and auth boundaries, exact running digest, persistence, backup integrity, disposable restore, no-op deployment, and rollback.

## 4. Complete operator workflow

Complete Phases 6–7: adapt `harkctl`, the installable skill, and product/operator documentation, then execute the complete web, auth, notification, interaction, Live Activity, accessibility, CLI, deletion, logging, and operations acceptance matrix.

Verification: retain command output and artifact identifiers sufficient to prove each checklist item without retaining secrets or user content.

## 5. Release and maintenance loop

Complete Phase 8: upload and install the final internal-TestFlight build, tag the proven release, record web/iOS/database/backup provenance, document manual operational checks, and record the deliberate upstream delta.

Verification: audit every fact in `facts.md` and every requirement in the authoritative plan against current tests, runtime checks, signed artifacts, device results, deployment state, and release records. Missing or indirect evidence means the goal remains incomplete.

## Stop conditions

- Stop before using Devil Phone artwork if either historical hash or ownership provenance cannot be proved.
- Stop rather than publishing a new anonymous page if App Store Connect requires a public privacy or support URL.
- Stop before creating external resources if a frozen identifier or domain must change.
- Never commit secrets, `.p8` material, tokens, private callback credentials, production user content, or unredacted logs.
