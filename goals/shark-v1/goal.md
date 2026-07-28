# Build and Release SHark v1

Build SHark v1 from the current Hark fork as the complete personal, noncommercial, Apple-only, self-hosted product specified in [`facts.md`](facts.md), following [`plan.md`](plan.md) and the repository's authoritative rebrand plan and confirmed handoff. Implement the source changes, create the operator-owned iOS and production identities, deploy the recoverable service, verify the full web/iOS/CLI/operations acceptance matrix, and release the proven build through internal TestFlight.

Preserve the frozen decisions and compatibility boundaries. Make progress autonomously from current evidence, but honor every documented stop condition and never substitute a smaller implementation for an unavailable external dependency.

## Done condition

The goal is done only when every accepted fact and every explicit requirement, checklist item, command, gate, invariant, and deliverable in `PLAN-shark-minimal-rebrand-self-host.md` has authoritative current evidence; the full automated baseline passes; the reviewed production Git SHA, running image digest, database migration, backup snapshot, EAS build, App Store Connect build, and release tag are recorded; the service is live at `https://shark.shuv.dev`; and the internal-TestFlight build has passed the complete two-iPhone acceptance matrix. Any missing, contradicted, stale, or indirect evidence keeps the goal active.
