# SHark iOS handoff candidate

The SHark-side candidate forwards only a default notification tap whose URL matches the
operator-configured `EXPO_PUBLIC_SSHUV_LINK_PREFIX`. It is **disabled by default**. No production
origin, receiving SSHuv app, site association, or signed-device handoff has been configured or
verified by this implementation.

The build setting contains the full canonical HTTPS prefix, ending in `/v1/`. Its namespace is
operator-selected; fixtures use `https://app.example.test/conversation/v1/` only as a synthetic
example. Notifications append one opaque base64url reference of 22–128 characters. The reference
must be assigned by the trusted host integration and resolved only after SSHuv authentication;
it must not contain a token, command, path, transcript, or raw agent session identifier.

The parser rejects a different scheme, origin, port, namespace, or version; user information;
encoded or normalized paths; queries/fragments; extra path components; and oversized references.
Configuration is build-time input, never taken from the incoming notification. A missing or invalid
prefix keeps normal inbox-first handling. Approval, denial, yes/no, and text reply actions continue
through the existing durable response queue and never become navigation.

`Linking.openURL` is attempted before opening detail for a valid configured destination. If that
call fails, SHark opens its existing durable detail. The OS accepting the call does **not** prove
that SSHuv opened: Safari can accept an HTTPS URL when app association is absent. The approved
origin therefore needs a safe, non-sensitive fallback and must not redirect to arbitrary locations.
Installed-app universal-link behavior and absent-app/association failures remain physical gates.

Cold-launch retrieval and the live listener share one response dispatcher. It coalesces concurrent
default-tap callbacks and immediate duplicate delivery for five seconds. A later intentional tap
opens again. Action responses retain their existing server/queue deduplication; failed local tap
handling can be retried.

## Acceptance still required

- Select the controlled prefix and opaque-reference mapping/retention contract with the SSHuv owner.
- Implement SSHuv associated domains, cold/warm URL handling, host enrollment/authentication,
  reference resolution, pending navigation, and current-request validation.
- Host the association file and safe fallback on the approved origin, without redirect-based routing.
- Build and install signed SHark and SSHuv candidates on shuvtest-phone.
- Prove cold, warm, background, and locked-phone taps; absent app; failed association; stale/offline
  or removed conversation; and no side-effecting agent action or terminal takeover from a tap.

The automated parser/dispatcher/routing tests establish local behavior only. They do not close
Phase 5 or the end-to-end release gate.
