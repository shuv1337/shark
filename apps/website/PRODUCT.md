# Product

<!-- impeccable:product-schema 1 -->

Written 2026-10-11 from the repository, `docs/`, and the owner's brief ("make it a full PWA, I
want it to be usable"). The owner asked to proceed without an interview, so facts marked
*(inferred)* come from the code and docs rather than a confirmed answer.

## Platform

web

## Users

One operator: the owner, who runs several AI coding agents (Claude Code, Codex, Cursor,
OpenCode, and others) on his own machines. The agents send him notifications, ask him questions
(approvals, choices, free-text replies), and post their status to a board. He answers from his
iPhone (the native SHark app), from the macOS companion, and from this web app in a desktop or
phone browser. *(inferred)* The web app is used when the phone app is not at hand, when a push
deep link opens in a browser, and for administration (devices, API tokens, MCP clients, teams,
on-call) that the phone app does not expose.

## Product Purpose

SHark is a private, self-hosted notification and decision service for one person's agents. The
web app is the operator's dashboard: see what agents sent, answer what they are waiting on, see
what they are working on, and manage the credentials and devices that connect them. Success is
that the operator never misses something an agent is blocked on, and can answer it in seconds
from whatever screen is in front of him.

## Positioning

It is the owner's own service: single-tenant, allowlisted Apple sign-in, no billing, no public
pages, data on his VM. Everything upstream Hark exposes publicly is deliberately absent here
(`docs/upstream-delta.md`). The board (agents' asks, in-flight work, notes) is the surface that
distinguishes it from a plain notification relay.

## Operating Context

- Agents reach the service through `sharkctl`, the installable skill, webhooks, and the MCP
  server; the web app is read-and-answer, not where work is created.
- The iPhone app opens `/board` inside its own chrome (`"hark" in window`) and registers a
  "web app" entry for `/dashboard`; push notifications carry deep links to `/board/ask/:id` and
  inbox items.
- Browser push (Web Push) is supported and must keep working.
- Production is `https://shark.shuv.dev` behind exe.dev, every page behind `requireAuth`; only an
  explicit allowlist of static assets is anonymous (`src/server/static.ts`).
- Dark and light follow the OS today; the operator works at night as well as in daylight
  *(inferred from usage times in the verification ledger)*.

## Capabilities and Constraints

- Surfaces: inbox (notifications, interactions, Live Activities, activity log), board (asks,
  work items, notes, with an SSE stream), services and API tokens, devices, browser
  notifications, MCP OAuth clients, teams (members, on-call groups, pages), invites, CLI
  authorization, MCP consent, docs, legal.
- Terminology: *ask* (a question for the operator, with options), *work item* (an agent's
  in-flight task with heartbeats), *note* (a heads-up), *interaction* (a notification-level
  question), *Live Activity*, *service* (an agent's sending identity), *team*, *on-call group*,
  *page*.
- Constraints: React 19, react-router, Vite, Tailwind v4 `@theme` tokens, Hono server, no client
  state library yet; vitest with happy-dom and `renderToStaticMarkup` tests; no testing-library.
  Brand assets are generated deterministically (`pnpm brand:check`). Protocol identifiers
  (`HARK_*`, token prefixes, routes) are preserved from upstream.
- Undecided: none for the current plan (`docs/plans/web-app-shell-pwa.md` records the five
  approved decisions).

## Brand Commitments

Name "SHark", the red shark mark (Devil Phone provenance in `docs/brand-provenance.md`), the
existing red accent and neutral palette in `src/client/index.css`. The plan keeps the palette.

## Evidence on Hand

Real content comes from the operator's own agents; test data is synthetic. Screenshots of the
current inbox were provided by the owner. No testimonials, metrics, or marketing claims exist
and none should be invented.

## Product Principles

- Answering an agent is the primary job; everything else is one tap away, never in the way.
- Familiar before clever: standard app navigation, standard controls, consistent vocabulary.
- Nothing anonymous but static assets; nothing cached that is personal.
- Works the same on a phone in a pocket and a desktop browser; installable on both.
- Live by default: what agents just did shows up without a refresh.
