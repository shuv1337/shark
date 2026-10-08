const DEFAULT_RETURN_PATH = "/dashboard";

/**
 * A same-site page path to land on after sign-in. Anything that could leave
 * the site, hit the API, or loop back into sign-in falls back to the dashboard.
 */
export function safeReturnPath(value: string | null | undefined, appUrl: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_RETURN_PATH;
  }
  let url: URL;
  try {
    const base = new URL(appUrl);
    url = new URL(value, base);
    if (url.origin !== base.origin) return DEFAULT_RETURN_PATH;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
  if (/^\/(api|hooks|login)(\/|$)/.test(url.pathname)) return DEFAULT_RETURN_PATH;
  // Check the normalized result too: dot segments such as `/.//evil.example`
  // collapse to a protocol-relative path that browsers resolve off-site.
  const path = `${url.pathname}${url.search}`;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) {
    return DEFAULT_RETURN_PATH;
  }
  return path;
}
