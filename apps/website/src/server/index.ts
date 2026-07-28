import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { app } from "./app";
import { sqlite } from "./db";
import { runMigrations } from "./db/migrate";
import { assertRuntimeEnv, env } from "./env";
import { pruneAnalytics } from "./lib/analytics";
import { startInteractionCallbackWorker } from "./lib/interaction-callbacks";
import { mountPrivateStaticRoutes } from "./static";

assertRuntimeEnv();
runMigrations();
// Bounds the analytics log at startup; long-running processes prune opportunistically.
pruneAnalytics();
startInteractionCallbackWorker();

// In production the same process serves authenticated noindex application
// shells. Unknown paths remain real 404s.
const clientDir = resolve(process.cwd(), "dist/client");
mountPrivateStaticRoutes(app, clientDir);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`SHark API listening on http://localhost:${info.port} (${env.NODE_ENV})`);
  if (!existsSync(clientDir)) {
    console.log("No dist/client build found — expecting the Vite dev server to proxy /api.");
  }
});

/**
 * WAL data only lands in the main database file on a clean close. Without this,
 * `hark.sqlite` stays stale and any file-level backup of it is effectively empty.
 */
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, checkpointing SQLite and shutting down.`);
  server.close(() => {
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
      sqlite.close();
    } catch (error) {
      console.error("Failed to checkpoint SQLite on shutdown", error);
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
