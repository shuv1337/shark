import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildServiceWorker({ root = resolve(import.meta.dirname, "..") } = {}) {
  const clientDir = resolve(root, "dist/client");
  const manifestPath = resolve(clientDir, ".vite/manifest.json");
  const workerPath = resolve(clientDir, "sw.js");
  const [manifestText, source] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(workerPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const files = new Set();
  for (const entry of Object.values(manifest)) {
    for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
      if (typeof file === "string" && file.startsWith("assets/")) files.add(`/${file}`);
    }
  }
  const precache = [...files].sort();
  const serialized = JSON.stringify(precache);
  const version = createHash("sha256")
    .update(source)
    .update("\0")
    .update(serialized)
    .digest("hex")
    .slice(0, 16);
  if (!source.includes("/* __PRECACHE__ */ []") || !source.includes('"__VERSION__"')) {
    throw new Error("Service worker build placeholders are missing.");
  }
  const built = source
    .replace("/* __PRECACHE__ */ []", serialized)
    .replace('"__VERSION__"', JSON.stringify(version));
  await writeFile(workerPath, built);
  return { precache, version, workerPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildServiceWorker();
  console.log(`wrote ${result.workerPath} with ${result.precache.length} precached assets`);
}
