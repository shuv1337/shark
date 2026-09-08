# Completion content reference prototype

This pure, unpublished prototype prepares the deterministic content rules in
`PLAN-shark-agent-reply-routing.md` (completed-turn formatting and Phase 4). It
does not implement `sharkd`, select a broker seam, or add a `sharkctl` package API.

`formatCompletionContent` accepts a summary string (which may be empty only when
an explicit question exists), optional question/title, and required idempotency
key. It trims inputs, defaults the title to SHark, truncates only the summary,
and rejects oversized or empty required values without echoing private content.
A question remains exactly intact after trimming; no question is inferred from
prose. The result contains content fields and a normalized key, not a complete
registration or ready-to-send broker operation.

Limits use JavaScript UTF-16 units, matching the actual Zod server schemas.
Summary truncation avoids introducing an unpaired surrogate. When the first
summary code point cannot fit beside the separator and question, both summary
and separator are omitted. This Unicode truncation choice is explicit; the plan
does not specify a separate grapheme policy. A valid existing input is never
rewritten to synthesize a question.

Run the boundary fixtures, including checks against the real shared contracts:

```sh
node --experimental-strip-types --test docs/agent-reply-routing/completion-prototype/format.test.mjs
pnpm exec biome check docs/agent-reply-routing/completion-prototype
```

Node 22.13+ supports the type-stripping flag used to import the repository's
TypeScript contracts. No dependency installation or model call is needed.

Integration remains pending: move or adapt this helper only after the broker
package/seam gate closes, then wire command parsing, device selection, expiry,
trusted conversation identity, durable idempotency/outbox records, authentication,
network outcome handling, agent admission, and exit codes. The prototype does not
validate any of those behaviors or close Phase 2, Phase 4 integration, or release.
