import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildServiceWorker } from "./build-sw.mjs";

test("buildServiceWorker injects sorted hashed assets and a version", async () => {
  const root = await mkdtemp(join(tmpdir(), "shark-build-sw-"));
  try {
    await mkdir(join(root, "dist/client/.vite"), { recursive: true });
    await writeFile(
      join(root, "dist/client/.vite/manifest.json"),
      JSON.stringify({
        entry: { file: "assets/main-bbb.js", css: ["assets/main-aaa.css"], assets: ["logo.png"] },
        chunk: { file: "assets/chunk-ccc.js" },
      }),
    );
    await writeFile(
      join(root, "dist/client/sw.js"),
      'const PRECACHE = /* __PRECACHE__ */ []; const VERSION = "__VERSION__";',
    );

    const result = await buildServiceWorker({ root });
    assert.deepEqual(result.precache, [
      "/assets/chunk-ccc.js",
      "/assets/main-aaa.css",
      "/assets/main-bbb.js",
    ]);
    const output = await readFile(join(root, "dist/client/sw.js"), "utf8");
    assert.doesNotMatch(output, /__PRECACHE__|__VERSION__/);
    assert.match(output, /\/assets\/main-bbb\.js/);
    assert.match(output, /const VERSION = "[a-f0-9]{16}"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
