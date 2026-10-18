# SHark web app: shell, navigation, and installable PWA

Status: approved 2026-10-11 (owner accepted every default). Decisions:

1. Four tabs: Board, Inbox, Teams, Settings. Activity is an Inbox filter; Live Activities list
   on the Inbox page.
2. Installed start URL: `/board`.
3. Hand-rolled service worker build step; no `vite-plugin-pwa`.
4. TanStack Query adopted in Phase 3, once the pages exist.
5. Ship after Phase 2 and iterate; Phase 3 follows as its own deploy.

## Why

The web UI at `https://shark.shuv.dev` is a set of unrelated pages. The screenshot of the inbox
shows the whole navigation: Docs, your email, a badge, Sign out. The findings from reading
`apps/website/src/client`:

- `/board` exists (`pages/Board.tsx`, lanes for asks, in-flight work, notes) but **nothing links
  to it**. It is reachable only from a push deep link, the iPhone app's web view, or by typing
  the URL.
- `/dashboard` is one 1,200-line page: inbox, services, API tokens, browser notifications,
  devices, MCP clients, teams, Live Activities, activity log, stacked top to bottom with no
  section navigation.
- Each page renders its own header. There are three header variants with different heights, and
  no mobile navigation of any kind.
- Several classes referenced by the list panels and inputs (`hark-glass`, `hark-glass-strong`,
  `hark-field`, `hark-link`, `legal-copy`, the `mint` badge colour) are defined nowhere. They came
  from an upstream Hark restyle that this fork never took, so panels and inputs render with no
  background or border and the "ok" badge has no colour. This is most of why the UI looks
  unfinished.
- Not a PWA: no web manifest, no `apple-touch-icon`, no install path, no offline handling. The
  service worker (`public/sw.js`) handles push only and is registered only when the Dashboard
  mounts, so a user who opens `/board` first has no push wiring.
- Live updates are uneven: the board has an SSE stream, the inbox relies on service worker
  messages and tab focus, the dashboard polls every 10 s.
- Theme follows `prefers-color-scheme` only; there is no user setting.
- No 404 page, no error boundary, no loading states beyond text.

## Goals

1. One app shell with primary navigation that includes the board, on desktop and phone.
2. Installable PWA on iOS, macOS Safari, and Chromium: manifest, icons, standalone display,
   safe-area layout, offline shell with a clear "offline" state, update prompt, app badge.
3. Every surface reachable in at most two taps; the Dashboard split into pages.
4. The things that look broken today fixed: undefined classes, inconsistent buttons, three
   `relativeTime` implementations.
5. Nothing weaker: the private boundary (`requireAuth` on every page and on `/assets/*`), the
   anonymous asset allowlist, the push flow, and the iPhone app's embedded web view (`"hark" in
   window` hides chrome) all keep working.

## Non-goals

- A redesign of the brand or colour tokens. The existing `@theme` palette stays.
- Native-app parity (Live Activity rendering, on-call paging from the browser).
- A client state library migration unless Phase 3 needs it (**DECIDE** below).
- Public pages. Everything stays behind the allowlisted Apple session.

## Information architecture

Proposed primary navigation (top bar on `md+`, bottom tab bar on phones):

| Nav item | Route | Content | Today |
|---|---|---|---|
| Board | `/board`, `/board/ask/:id` | asks, in-flight work, notes; badge = asks waiting on you | exists, unlinked |
| Inbox | `/inbox`, `/inbox/:id` | notifications, interactions, Live Activities; badge = unread | top of `/dashboard`, modal detail |
| Activity | `/activity` | activity log + live activities | bottom of `/dashboard` |
| Teams | `/teams`, `/teams/:id` | team list, members, on-call, pages | section of `/dashboard` + `/dashboard/teams/:id` |
| Settings | `/settings` with sections | account, browser notifications, devices, services + API tokens, MCP clients, install app, theme | middle of `/dashboard` |

Secondary: Docs (header link, unchanged), Sign out (account menu). `/dashboard` and
`/dashboard/teams/:id` become redirects, so existing push deep links and the iPhone app's
registered web app keep working. The service worker's `/inbox → /dashboard` rewrite is removed.

**DECIDE 1.** Five tabs as above, or four (fold Activity into Inbox as a filter)? Phones fit five;
four is calmer. Default proposal: four, with Activity as an Inbox filter and the Live Activities
list on the Inbox page.

**DECIDE 2.** Start URL when installed: `/board` or `/inbox`? The board is what agents wait on;
the inbox is what the phone app opens to. Default proposal: `/board`.

## Phases

Each phase is one reviewable PR (Cursor Git Watch plus an independent reviewer, like the
follow-up batch), merged in order, deployed together at the end or per phase if you prefer.

### Phase 0: shell and repairs (no behaviour change for push or auth)

- `AppShell` layout: header (brand mark, nav, account menu with email, self-hosted badge, sign
  out), content column, bottom tab bar under `md`. Pages mount inside it via a layout route.
  The embedded web view (`"hark" in window`) renders no shell, as the board does today.
- Define or replace the undefined classes. Proposal: replace `hark-glass*` with the tokens the
  board cards already use (`bg-surface border-line shadow-xs`), define `hark-field` and
  `hark-link` once in `index.css`, give `Badge` ok tone a real colour from the palette.
- One `relativeTime`, one `Field`, one `InlineCode`; buttons from `components/ui.ts` everywhere.
- 404 route, top-level error boundary, a loading skeleton primitive.
- Register the service worker at app boot (not only on Dashboard mount).
- Tests: shell renders nav and hides it in the embedded web view; 404; every route resolves.

### Phase 1: pages

- Split `Dashboard.tsx` into `/inbox`, `/activity` (or filter), `/teams`, `/settings`, each using
  the existing section components (`InboxPanel`, `Devices`, `ServiceList`, `McpClientsSection`,
  `TeamsSection`, `LiveActivities`, `ActivityLog`).
- `/inbox/:id` detail as a route (deep-linkable, back button works) instead of a modal.
- Redirects for `/dashboard` and `/dashboard/teams/:id`. Server `static.ts` shells updated.
- Board linked from nav with its "waiting on you" count; Inbox unread count.
- Tests: redirects, detail route, counts.

### Phase 2: PWA

- `manifest.webmanifest`: name, short name, `start_url` (**DECIDE 2**), `display: standalone`,
  `scope: /`, theme and background colours per scheme, icons 192/512 plus maskable, generated by
  `scripts/generate-brand-assets.mjs` so `pnpm brand:check` stays deterministic. Apple touch icon
  180. `index.html`: manifest link, `apple-touch-icon`, `apple-mobile-web-app-capable`,
  status-bar style, `viewport-fit=cover`.
- Static boundary: the manifest and icons join the anonymous allowlist (`PUBLIC_PUSH_ASSETS`,
  renamed `PUBLIC_APP_ASSETS`); `static.test.ts` and `docs/operations.md` "Manual checks" and
  `docs/upstream-delta.md` updated. The manifest contains no account content.
- Service worker: keep push handling; add an app-shell precache of the hashed bundle and a
  navigation fallback so the shell opens offline, API requests network-only (never cache
  authenticated JSON), an offline banner in the shell, and a controlled update flow ("New
  version, reload") instead of silent `skipWaiting`.
- Install: capture `beforeinstallprompt` on Chromium and show an "Install SHark" button in
  Settings; on iOS Safari show the Add to Home Screen steps. Detect `display-mode: standalone`
  to hide the install section and apply safe-area padding to the tab bar.
- App badge: `navigator.setAppBadge` with the board waiting count plus unread inbox, cleared
  when both are zero.
- Tests: manifest served anonymously and well-formed; icons present; SW fetch handler never
  caches `/api/*`; update flow; `static.test.ts` allowlist.

**DECIDE 3.** Hand-rolled SW build step (a small script that writes the precache list from Vite's
manifest) or `vite-plugin-pwa` (Workbox). Hand-rolled keeps the dependency surface and the
existing `sw.js` push code as is; the plugin is more features for less code but is a new
dependency behind the Socket Security check. Default proposal: hand-rolled.

### Phase 3: live and usable

- One live-update hook for board and inbox: extend the board SSE stream to carry inbox changes
  (or add a general `/api/stream`), used by nav badges, pages, and the app badge; keep the
  focus/visibility and poll fallbacks.
- Theme setting: system / light / dark in Settings, stored locally, applied with the existing
  dark token remap.
- Board: answer with free text where the ask allows it, snooze, filter by agent, keyboard
  shortcuts for the first ask (`y`/`n`/`enter`). Inbox: pull-to-refresh on phones.
- Empty states and skeletons on every page.

**DECIDE 4.** Adopt a fetch cache (TanStack Query) in this phase so pages share data and
navigation is instant, or keep the per-page `useState` pattern? Default proposal: adopt it here,
not earlier, once the pages exist.

### Phase 4: verification, docs, deploy

- Lighthouse PWA audit recorded in `docs/verification.md` (installability, offline shell).
- iOS Safari install and standalone run on your iPhone; macOS Safari and Chrome install.
- `docs/operations.md` manual checks: manifest and icons anonymous, everything else 401.
- Publisher run, detached promotion, ledger entry, as today.

## Risks

- **Anonymous surface grows** by a manifest and icon files. They are static and contain no
  account data, like `/sw.js` and `/favicon.png` today. Reviewers should check that nothing else
  leaks into the allowlist.
- **Service worker caching and auth.** A precached shell is fine; a cached API response would be
  a privacy bug on a shared device. The fetch handler must be allowlist-only (`/assets/*`, shell
  routes) and tested for it.
- **Deep links.** `/dashboard` redirects must keep the iPhone app's registered web app and old
  push URLs working. Test both.
- **Embedded web view.** The iPhone app opens `/board` inside its own chrome; the shell must stay
  hidden there, and the tab bar must not appear.

## Order and size

Phase 0 and 1 together are about two days of agent work with reviews; Phase 2 one day; Phase 3
one to two days. Phases 0 to 2 are the minimum for "usable and installable"; Phase 3 is polish.

**DECIDE 5.** Ship after Phase 2 and iterate, or hold the deploy until Phase 3?
