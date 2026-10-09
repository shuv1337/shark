# SHark iOS handoff candidate

The SHark-side candidate forwards only a default notification tap whose URL matches the
operator-configured `EXPO_PUBLIC_SSHUV_LINK_PREFIX`. It is **disabled by default**. On October 8,
2026 the operator selected `https://shark.shuv.dev/conversation/v1/`. The server now supplies
the association file for `7H54B326YZ.dev.shuv.sshuv` and a static, non-sensitive fallback.
The SSHuv companion change adds the receiver, associated domains, authenticated reference
resolution, and pending foreground navigation. Signed-device acceptance is still open.

The build setting contains the full canonical HTTPS prefix, ending in `/v1/`. Its namespace is
operator-selected; fixtures use `https://app.example.test/conversation/v1/` only as a synthetic
example. Notifications append one opaque base64url reference of 22–128 characters. The reference
must be assigned by the trusted host integration and resolved only after SSHuv authentication;
it must not contain a token, command, path, transcript, or raw agent session identifier.

The receiving contract uses a 75-character reference with a 24-hour expiry, an opaque issuer
fingerprint, and a host-authenticated MAC. `sshuv-hook handoff --agent-id EXACT_AGENT_ID --json`
obtains it from the already-paired host's current snapshot. SSHuv selects the matching enrolled
host installation, resolves over its authenticated SSH connection, and revalidates the exact
current session and connection. Token rotation, host reinstallation, expiry, removal, or rebinding
invalidates the reference. The public SHark server never resolves or stores native identities.
Opening the link reads the existing conversation view; it does not approve, send, or attach.

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

- Deploy and verify the association file and safe fallback on the approved origin.
- Build a SHark candidate with `EXPO_PUBLIC_SSHUV_LINK_PREFIX=https://shark.shuv.dev/conversation/v1/`
  and the SSHuv companion receiver; install both on the operator-selected **shuvphone**.
- Update its paired host to hook 0.4.5 and obtain a reference for the exact current conversation.
- Prove cold, warm, background, and locked-phone taps; absent app; failed association; stale/offline
  or removed conversation; and no side-effecting agent action or terminal takeover from a tap.

The automated parser/dispatcher/routing tests establish local behavior only. They do not close
Phase 5 or the end-to-end release gate.

The user postponed physical-device installation/testing. Do not substitute another phone or
interpret a simulator, build, upload, or Apple association-file fetch as physical acceptance.
