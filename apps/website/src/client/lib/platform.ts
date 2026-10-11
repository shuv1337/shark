/**
 * The SHark iPhone app opens web pages inside its own chrome and injects a
 * `hark` global. Every surface that would otherwise draw a header, navigation
 * or a tab bar asks here first, so the embedded view stays bare.
 */
export function inEmbeddedWebView(): boolean {
  return typeof window !== "undefined" && "hark" in window;
}
