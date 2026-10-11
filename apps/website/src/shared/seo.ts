import { BRAND } from "./brand";

export const SITE_URL = BRAND.origin;

export type SeoPage =
  | "home"
  | "docs"
  | "privacy"
  | "terms"
  | "dashboard"
  | "board"
  | "inbox"
  | "teams"
  | "settings"
  | "join"
  | "oauthConsent"
  | "notFound"
  | "cliAuthorize";

export interface PageSeo {
  path: string;
  title: string;
  description: string;
  index: false;
}

export const PAGE_SEO: Record<SeoPage, PageSeo> = {
  home: {
    path: "/",
    title: "SHark — Private Webhooks to iPhone",
    description: "Private operator dashboard for SHark notifications and Live Activities.",
    index: false,
  },
  docs: {
    path: "/docs",
    title: "SHark API Documentation",
    description: "Private SHark API and operator documentation.",
    index: false,
  },
  privacy: {
    path: "/privacy",
    title: "Privacy — SHark",
    description: "How this private SHark deployment handles operator data.",
    index: false,
  },
  terms: {
    path: "/terms",
    title: "Terms — SHark",
    description: "Terms for this private, noncommercial SHark deployment.",
    index: false,
  },
  dashboard: {
    path: "/dashboard",
    title: "Dashboard — SHark",
    description: "Manage private SHark services, devices, activity, and agent connections.",
    index: false,
  },
  board: {
    path: "/board",
    title: "Board — SHark",
    description: "What your agents are waiting on, working on, and finished.",
    index: false,
  },
  inbox: {
    path: "/inbox",
    title: "Inbox — SHark",
    description: "Notifications, interactions, Live Activities, and webhook activity.",
    index: false,
  },
  teams: {
    path: "/teams",
    title: "Teams — SHark",
    description: "Teams, members, on-call groups, and pages.",
    index: false,
  },
  settings: {
    path: "/settings",
    title: "Settings — SHark",
    description: "Account, browser notifications, devices, services, and connected clients.",
    index: false,
  },
  join: {
    path: "/join",
    title: "Join a team — SHark",
    description: "Accept a private SHark team invite.",
    index: false,
  },
  oauthConsent: {
    path: "/oauth/consent",
    title: "Authorize a client — SHark",
    description: "Review and authorize an MCP client connection.",
    index: false,
  },
  notFound: {
    path: "/404",
    title: "Not found — SHark",
    description: "This address does not exist on this private SHark deployment.",
    index: false,
  },
  cliAuthorize: {
    path: "/cli/authorize",
    title: "Authorize SHark CLI",
    description: "Review and authorize a SHark CLI connection.",
    index: false,
  },
};

/**
 * The pages the build writes a noindex application shell for. `notFound` is
 * the shell the server returns for any other path it does not recognise, so
 * the client renders its own 404 instead of bare text.
 */
export const PRIVATE_PAGES = [
  "home",
  "docs",
  "privacy",
  "terms",
  "dashboard",
  "board",
  "inbox",
  "teams",
  "settings",
  "notFound",
  "cliAuthorize",
] as const satisfies readonly SeoPage[];

export function absoluteUrl(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

/** Nested routes that take their parent page's metadata. */
const NESTED_PREFIXES: [prefix: string, page: SeoPage][] = [
  ["/board/", "board"],
  ["/inbox/", "inbox"],
  ["/teams/", "teams"],
  ["/dashboard/", "dashboard"],
  ["/join/", "join"],
];

export function seoPageForPath(pathname: string): SeoPage | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [prefix, page] of NESTED_PREFIXES) {
    if (normalized.startsWith(prefix)) return page;
  }
  for (const [page, metadata] of Object.entries(PAGE_SEO) as [SeoPage, PageSeo][]) {
    if (metadata.path === normalized) return page;
  }
  return null;
}
