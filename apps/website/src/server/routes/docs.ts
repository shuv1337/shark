import { Hono } from "hono";
import { docsMarkdown, llmsTxt } from "../../shared/docs/markdown";
import { type AuthedEnv, requireAuth } from "../middleware";

/**
 * Plain-text views of the docs for agents, crawlers, and `curl`.
 *
 * Both bodies are derived from the same content model the React page renders, so
 * they can never fall behind `/docs`. They are generated once per process: the
 * content is a compile-time constant, so there is nothing to invalidate.
 */
const markdown = docsMarkdown();
const llms = llmsTxt();

/** Long, because these change only when the app is redeployed. */
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

export const docsTextRoute = new Hono<AuthedEnv>();

for (const path of ["/docs.md", "/agents.md"]) {
  docsTextRoute.get(path, requireAuth, (c) => {
    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Cache-Control", CACHE_CONTROL);
    c.header("Link", '<https://shark.shuv.dev/docs>; rel="canonical"');
    c.header("X-Robots-Tag", "noindex, nofollow");
    return c.body(markdown);
  });
}

docsTextRoute.get("/llms.txt", requireAuth, (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", CACHE_CONTROL);
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.body(llms);
});
