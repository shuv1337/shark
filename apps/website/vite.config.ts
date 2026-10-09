import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const API_URL = process.env.API_PROXY_TARGET ?? "http://localhost:8788";

/**
 * Serves the generated docs text views from the Vite dev server.
 *
 * In production these come from the Hono app (`src/server/routes/docs.ts`). Dev
 * generates them here instead of proxying to the API process, so they work even
 * when only `vite` is running; without this they look like missing static files
 * to Vite and 404. `/docs` itself stays client-rendered in dev and is
 * prerendered only by the production build.
 */
function docsTextPlugin(): Plugin {
  const routes: Record<string, { module: "docsMarkdown" | "llmsTxt"; type: string }> = {
    "/docs.md": { module: "docsMarkdown", type: "text/markdown; charset=utf-8" },
    "/agents.md": { module: "docsMarkdown", type: "text/markdown; charset=utf-8" },
    "/llms.txt": { module: "llmsTxt", type: "text/plain; charset=utf-8" },
  };

  return {
    name: "hark-docs-text",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        const route = path ? routes[path] : undefined;
        if (!route) return next();

        // Loaded through Vite so the docs content model stays the single source.
        const module = await server.ssrLoadModule("/src/shared/docs/markdown.ts");
        res.setHeader("Content-Type", route.type);
        res.end(module[route.module]());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), docsTextPlugin()],
  build: {
    outDir: "dist/client",
  },
  server: {
    port: 8787,
    strictPort: true,
    proxy: {
      "/api": API_URL,
      "/hooks": API_URL,
      // Remote MCP server and its OAuth discovery documents.
      "/mcp": API_URL,
      "^/\\.well-known/oauth-": API_URL,
    },
  },
});
