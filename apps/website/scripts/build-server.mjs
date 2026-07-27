import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // better-sqlite3 is a native module; expo-server-sdk reads its own package.json at runtime.
  external: ["better-sqlite3", "expo-server-sdk"],
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
};

await build({
  ...shared,
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server/index.js",
});

await build({
  ...shared,
  entryPoints: ["scripts/offboard-user.ts", "scripts/backup-database.ts", "scripts/analytics.mjs"],
  outdir: "dist/operator",
});
