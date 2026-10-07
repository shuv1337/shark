import { BRAND } from "./brand";

export const SITE_URL = BRAND.origin;

export type SeoPage =
  | "home"
  | "docs"
  | "privacy"
  | "terms"
  | "dashboard"
  | "board"
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
  cliAuthorize: {
    path: "/cli/authorize",
    title: "Authorize SHark CLI",
    description: "Review and authorize a SHark CLI connection.",
    index: false,
  },
};

export const PRIVATE_PAGES = [
  "home",
  "docs",
  "privacy",
  "terms",
  "dashboard",
  "board",
  "cliAuthorize",
] as const satisfies readonly SeoPage[];

export function absoluteUrl(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

export function seoPageForPath(pathname: string): SeoPage | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized.startsWith("/board/")) return "board";
  for (const [page, metadata] of Object.entries(PAGE_SEO) as [SeoPage, PageSeo][]) {
    if (metadata.path === normalized) return page;
  }
  return null;
}
