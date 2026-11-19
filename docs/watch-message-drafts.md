# Private message drafts on Apple Watch (local implementation)

This is a draft review surface, not a second initial approval. A trusted caller resolves
and verifies the recipient before creating a draft. The watch displays the exact recipient
and complete text, then offers Send, Edit and Deny. Native text entry starts with the existing
text and uses the watchOS-selected input method (including Dictation); it does not force a
particular keyboard. Save returns to preview and never sends.

## Bridge contract

- Agent creates a pending draft at `/api/agent/message-drafts`, with a stable idempotency key,
  verified recipient descriptor and exact text. Recipient resolution is the bridge's job;
  a caller-supplied verification label is not independent proof of address ownership.
- Watch fetches `/api/watch/message-drafts/next` (separate from legacy snapshot/cache).
- Edit requires expected revision and action digest, replaces the body and increments revision.
- Send/Deny requires the same revision and digest. Send atomically approves one immutable
  revision. The creator bridge then claims that revision once at `/:id/claim`, creating an
  operation ID. Neither transition is proof of delivery.
- Bridge reads that claimed operation and sends only its frozen recipient and text. It must
  deduplicate by operation ID and must not automatically retry an ambiguous provider timeout.
- Delivery receipt distinguishes delivered, failed and unknown. Denied/expired drafts never send.

Drafts are private, authenticated owner-only state. Full text is never placed in Watch snapshot
UserDefaults. Draft preview clears on backgrounding. Hidden details removes the Send controls;
legacy cached/stale state cannot send. There is no message truncation before the Send button.
The server remains authoritative for expiry and concurrent edits/claims.

## Verification limits

Use synthetic recipients and mocked providers until deployment is separately authorized.
No real notification or message is sent by these source tests. This does not establish that
an installed watch build has been updated. A physical-watch test must verify native Dictation,
long-body scrolling, background privacy, concurrent edit/Send conflicts and network-loss UX.
