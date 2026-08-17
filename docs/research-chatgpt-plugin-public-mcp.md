# Public ChatGPT plugin and remote MCP for SHark

Research snapshot: 2026-08-15. This is a read-only implementation assessment based on the current
repository and current official OpenAI/MCP documentation.

## Recommendation

Build a **tool-only MCP-backed plugin** first: no custom UI and no shell dependency. Host one
authenticated, universal Streamable HTTP endpoint at `https://shark.shuv.dev/mcp`. For the first
release, expose only:

1. `send_notification` — send one notification to the authenticated user's SHark targets;
2. `get_connection_status` — report whether any active delivery target exists, without returning
   device identifiers or personal data; and
3. optionally, after the one-way path is proven, `ask_user` plus `get_interaction` for asynchronous
   approval/yes-no responses.

OAuth account linking is the registration/bootstrap flow. Do **not** add a `register` tool or accept
tokens, passwords, one-time codes, or Apple credentials as tool input. A cloud agent that has no
shell can connect to SHark through its host's MCP/OAuth UI and then call these tools.

This is feasible, but there are two different launch goals:

- A **publicly reachable, privately authorized MCP server** can be developed and tested now in
  ChatGPT/Codex developer mode and by other compatible clients.
- A **public directory plugin** requires a product decision first. SHark currently describes itself
  as a personal, single-operator deployment with exact-email admission and no public signup, and its
  terms say it is not offered as a public service
  ([current privacy and terms](../apps/website/src/client/pages/Legal.tsx)). Those claims, the support
  model, and the repository's noncommercial license posture must be reconciled before a public
  listing. Otherwise, stop at private/developer-mode distribution.

## What exists and what is missing

SHark already has most of the notification domain layer that an MCP adapter should call directly:

- scoped agent bearer tokens and scope enforcement
  ([middleware](../apps/website/src/server/middleware.ts),
  [token routes](../apps/website/src/server/routes/api-tokens.ts));
- `notifications:send`, interaction, device, service, event, activity, and watch scopes
  ([contracts](../packages/contracts/src/index.ts));
- idempotent one-shot notifications and interaction APIs, rate/quota checks, and fan-out to iOS and
  Web Push ([agent routes](../apps/website/src/server/routes/interactions.ts)); and
- an interactive device-code flow used by `sharkctl`
  ([device authorization](../apps/website/src/server/routes/device-authorization.ts)).

The current device-code flow and `hark_...` tokens are **not** the OAuth 2.1 authorization-server
contract required by a published ChatGPT plugin. Missing pieces are:

- an MCP Streamable HTTP route and MCP tool metadata;
- protected-resource and OAuth/OIDC discovery documents;
- authorization-code + PKCE, OpenAI client identification/registration, redirect handling, and
  OAuth consent;
- access/refresh token issuance, audience binding, rotation/revocation, and per-call validation;
- public MCP/privacy/support documentation and operational telemetry; and
- submission fixtures, reviewer credentials, tests, domain verification, and publisher identity.

## Target architecture

Keep the MCP adapter in the existing TypeScript website service so it can invoke the existing
notification functions and database transaction boundaries without forwarding a long-lived SHark
API token through an internal HTTP request.

```text
ChatGPT / Codex / compatible MCP client
             |  Streamable HTTP + OAuth bearer token
             v
 https://shark.shuv.dev/mcp
             |
     MCP auth + tool adapter
             |
 existing SHark notification/interaction domain
             |
      iOS, watchOS, and Web Push targets
```

Use the official TypeScript MCP SDK. OpenAI requires a stable, publicly reachable HTTPS production
endpoint supporting MCP Streamable HTTP; a local URL or Secure MCP Tunnel is suitable only for
developer-mode testing, not public submission
([build an MCP server](https://developers.openai.com/plugins/build/mcp-server)). The endpoint being
publicly reachable does not make notification data public: every user-specific or mutating tool must
require and validate OAuth.

Prefer an established OAuth 2.1 authorization server, as OpenAI explicitly recommends, while
mapping its authenticated subject to the existing SHark user and retaining SHark's admission
checks. Reusing Apple as the upstream sign-in experience is reasonable; treating the existing
Better Auth session or CLI device-code flow as if it were an OAuth authorization server is not.

SHark currently uses Better Auth 1.6.25. Its separately packaged OAuth Provider can supply OAuth
2.1/OIDC, refresh tokens, and DCR, but the current MCP authorization profile prefers CIMD and keeps
DCR only for backward compatibility. Better Auth documents CIMD support in its 1.7 beta line as of
this research snapshot; the `@better-auth/cimd` beta explicitly implements CIMD draft-02 with the
MCP 2026-07-28 profile, so the upgrade path is concrete but not yet stable. Before implementation,
choose either a production authorization provider
with mature CIMD support now, or a tested Better Auth upgrade after that support is stable. A
private prototype may use the stable Better Auth provider and DCR to validate the flow, but do not
hand-roll authorization and do not make DCR the intended public-launch architecture
([Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider),
[Better Auth CIMD beta](https://better-auth.com/docs/beta/plugins/cimd)).

The OAuth surface must include:

- `GET /.well-known/oauth-protected-resource` describing the canonical MCP resource, authorization
  server, supported scopes, and documentation;
- OAuth authorization-server or OIDC discovery metadata;
- authorization-code flow with PKCE `S256`;
- the `resource` parameter propagated through authorization and token exchange and bound into the
  access token audience;
- Client ID Metadata Documents (CIMD) as the preferred ChatGPT client-registration method, with DCR
  or a predefined client only where needed;
- compatible token endpoint auth (`none` or `private_key_jwt` for CIMD);
- short-lived access tokens, revocable/rotated refresh tokens, and a consent/revocation record; and
- validation of signature, issuer, audience/resource, `exp`/`nbf`, subject, admission, and scopes on
  every MCP request.

An unauthenticated call should return the protected-resource `WWW-Authenticate` challenge. Each
tool must also declare an OAuth `securitySchemes` entry with its exact scopes, and an auth-required
tool result must include `_meta["mcp/www_authenticate"]`; ChatGPT needs all of those signals to show
account linking. See OpenAI's
[plugin authentication guide](https://developers.openai.com/plugins/build/auth) and the primary
[MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

## Tool contracts and confirmation behavior

Do not mirror the whole agent REST API. OpenAI recommends focused tools aligned to user goals, with
separate read/write operations, explicit schemas, structured outputs, authorization, failure
behavior, and accurate safety annotations
([define tools](https://developers.openai.com/plugins/plan/tools)).

| Tool | Scope | Inputs and result | Annotations |
| --- | --- | --- | --- |
| `send_notification` | `notifications:send` | Required `body` and stable `idempotency_key`; optional `title`, public HTTPS `image_url`, safe HTTPS `open_url`. Return only `accepted`, `idempotent`, and a useful status such as `accepted` or `no_targets`. | `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: false`* |
| `get_connection_status` | a new narrow target-status read scope, or temporarily `devices:read` | Return aggregate active target counts/capabilities, not device IDs, names, push tokens, or account data. | `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` |
| `ask_user` (phase 2) | `notifications:send`, `interactions:create` | Explicit prompt/type/expiry/idempotency key; return interaction handle and accepted count. | `readOnlyHint: false`, `destructiveHint: true`, `openWorldHint: false`* |
| `get_interaction` (phase 2) | `interactions:read` | Explicit interaction handle; return only status and validated response fields. | `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` |

\* `openWorldHint: false` is an evidence-based interpretation while delivery is restricted to the
authenticated user's private, first-party SHark targets. OpenAI's review guidance permits false
only for tools operating "entirely within closed or private systems" that cannot change the state
of the publicly visible internet; a push to the user's own devices fits that definition, but the
exact notification case is not classified, so confirm the annotation during review. Sending is not safely reversible, so `destructiveHint: true` is the safer
classification under the review examples. Published write actions should use the host's approval
friction; annotations do not replace server-side authorization, input validation, rate limiting,
audit logging, or idempotency
([MCP review requirements](https://developers.openai.com/plugins/deploy/app-review),
[security and privacy](https://developers.openai.com/plugins/guides/security-privacy)).

Keep `idempotency_key` required at the MCP boundary and reuse SHark's existing payload-hash conflict
semantics. A retry with the same key and same payload returns the original result; the same key with
a different payload fails. The result must say that `accepted` is provider acceptance, not proof
that a device displayed the alert, matching the current SHark contract.

## Public submission and operating requirements

The current OpenAI product name is a **plugin**, and approved MCP-backed plugins appear in the
universal directory shared by ChatGPT and Codex. Submission requires
([submission guide](https://developers.openai.com/plugins/deploy/submission)):

- a verified individual or business publisher identity and Apps Management Write
  (`api.apps.write`) permission; per OpenAI's
  [submission maintenance article](https://help.openai.com/en/articles/20001040-submitting-apps-to-the-chatgpt-app-directory),
  an organization with EU data residency enabled currently cannot submit for review;
- a universal production MCP URL (the correct choice for SHark), production logo/listing copy,
  website, public support, privacy, and terms URLs, countries, release notes, and starter prompts;
- domain verification using the portal-provided token at
  `/.well-known/openai-apps-challenge` when requested;
- a successful Scan Tools pass with accurate schemas, security schemes, annotations, and server
  instructions;
- at least five positive and three negative reproducible test cases; and
- reviewer credentials that work from the public internet without MFA, SMS, email confirmation, or
  private-network access.

The last point is a concrete gap, and it is engineering work, not just account setup: SHark today
admits users only by exact Apple email and signs them in only through Apple, which always carries
Apple's own two-factor verification. A compliant reviewer login therefore requires the OAuth
authorization server to support a second, non-Apple credential path (for example a password-based
test identity that exists only in the authorization server) gated so it can never reach the
operator's account. Plan this into the OAuth phase rather than discovering it at submission time.
Provide a dedicated, least-privilege review tenant and
non-MFA review login supported by the OAuth provider, with isolated fixture targets and no access to
the operator's real notifications. It must exercise the real production tool path rather than a
mock-only/demo plugin. Revoke it after review if OpenAI's maintenance process permits, and be ready
to reissue it for updates.

Submitting starts review; it does not publish automatically. After approval, the publisher must
choose Publish. Directory search by exact name/direct link is expected; featured placement is not
promised. Reviewed MCP metadata is snapshotted: changes to tools, schemas, annotations, security
schemes, `_meta`, or server instructions require deploy, rescan, review, and republish
([review and versioning](https://developers.openai.com/plugins/deploy/app-review)).

Before public submission, revise the existing policies to accurately cover MCP/OAuth data, OpenAI
as a recipient/processor path, purposes, retention, deletion/revocation, logging, and support. Tool
results and logs must exclude access/refresh tokens, Apple credentials, push tokens, raw prompts,
unnecessary device/account identifiers, internal debug payloads, and undisclosed telemetry. Keep a
current support contact and operational alerts for initialization, auth, tool-call, rate-limit, and
delivery failures. OpenAI requires least privilege, explicit consent, server-side validation,
redacted logging, a published retention policy, deletion support, and accurate disclosure
([plugin guidelines](https://developers.openai.com/plugins/app-guidelines),
[security and privacy](https://developers.openai.com/plugins/guides/security-privacy)).

## Limits for cloud agents and chatbots

- Directory publication distributes the plugin to ChatGPT and Codex; it does not register SHark
  with other vendors. Another cloud agent can use the same endpoint only if its host supports remote
  MCP Streamable HTTP and a compatible OAuth 2.1 flow.
- ChatGPT does not support machine-to-machine grants such as client credentials, service accounts,
  or JWT bearer assertions, and cannot present a custom API key. This design therefore delegates a
  human SHark user's authority through OAuth; it is not unattended service identity
  ([OpenAI authentication limitations](https://developers.openai.com/plugins/build/auth)).
- An OAuth-capable cloud environment needs no Bash shell, but it still needs a user-facing account
  linking/consent step and durable secure token storage/refresh support. A headless host lacking that
  capability cannot use the published-plugin auth flow.
- With the OpenAI Responses API, the calling application must separately acquire the OAuth access
  token and pass it in the MCP tool's `authorization` field on every response-creation request; the
  Responses API deliberately does not store that value. The API supports Streamable HTTP and legacy
  HTTP/SSE, while public plugin submission specifically requires Streamable HTTP
  ([MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)).
- If SHark later needs true unattended bot identity, design that as a separate non-ChatGPT
  automation lane (for example, the existing scoped agent/webhook credentials with explicit secret
  provisioning). Do not weaken the user-delegated public plugin or pretend ChatGPT OAuth supports an
  M2M grant.

## Phased next steps

1. **Product gate:** choose private/developer-mode MCP or a genuinely supported public service;
   resolve admission, legal/license, publisher identity, public support, privacy, and terms.
2. **MCP core:** add the official TypeScript SDK, stateless Streamable HTTP `/mcp`,
   `get_connection_status`, and `send_notification`; reuse existing validation, billing, delivery,
   and idempotency domain code rather than HTTP-calling `/api/agent`.
3. **OAuth:** integrate an established authorization server, exact discovery/resource metadata,
   CIMD plus required fallback, PKCE S256, audience/scopes, revocation, and ChatGPT auth challenges;
   include the non-Apple, non-MFA reviewer credential path here, since Apple-only sign-in cannot
   satisfy review requirements.
4. **Security and operations:** add per-tool scopes, confirmation annotations, correlation-only audit
   logs, rate limits, prompt-injection/oversharing tests, health metrics, and credential-rotation
   procedures.
5. **Compatibility test:** verify with MCP Inspector, ChatGPT developer mode, Codex, the OpenAI API
   Playground/Responses API, and a small named matrix of other target clients. Record which support
   Streamable HTTP, CIMD/DCR, interactive OAuth, refresh, and approval prompts.
6. **Review readiness:** create an isolated non-MFA reviewer tenant, five positive and three negative
   cases, listing assets/policies/support pages, domain challenge handling, and a clean Scan Tools
   result.
7. **Publish:** submit from a globally resident Platform project, address review feedback, publish
   the approved version, and treat MCP metadata as a versioned public contract.

OpenAI does not publish a fixed review turnaround, does not guarantee featured distribution, and
does not guarantee other vendors' MCP/OAuth compatibility. Those remain operational validation
items rather than assumptions.
