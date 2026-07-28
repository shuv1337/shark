/** Writes noindex application shells only; SHark has no public prerendered pages. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BRAND } from "../src/shared/brand";
import { PAGE_SEO, PRIVATE_PAGES } from "../src/shared/seo";

const clientDir = resolve(import.meta.dirname, "../dist/client");
const shellPath = resolve(clientDir, "index.html");
const shell = await readFile(shellPath, "utf8");
if (!shell.includes('<div id="root"></div>')) {
  throw new Error("Cannot write private app shells: dist/client/index.html has no empty #root div");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function privateShell(page: (typeof PRIVATE_PAGES)[number]): string {
  const metadata = PAGE_SEO[page];
  const head = [
    "<!-- seo:start -->",
    `    <title data-seo="true">${escapeAttribute(metadata.title)}</title>`,
    `    <meta data-seo="true" name="description" content="${escapeAttribute(metadata.description)}" />`,
    '    <meta data-seo="true" name="robots" content="noindex, nofollow" />',
    `    <meta data-seo="true" name="application-name" content="${BRAND.productName}" />`,
    "    <!-- seo:end -->",
  ].join("\n");
  return shell.replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, head);
}

for (const page of PRIVATE_PAGES) {
  const path = PAGE_SEO[page].path;
  const outputPath = path === "/" ? shellPath : resolve(clientDir, path.slice(1), "index.html");
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, privateShell(page));
  console.log(`wrote private shell ${path} → ${outputPath}`);
}
