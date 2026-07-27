import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(import.meta.dirname, "..");
const sourceSvgPath = resolve(root, "assets/brand/devil-phone.svg");
const safeRasterPath = resolve(root, "assets/brand/icon-maskable-512.png");
const checkOnly = process.argv.includes("--check");

const expectedSources = {
  [sourceSvgPath]: "3489212420a5c2cbaa56cec28933b1e1284739b11e3388650ea3fb8a4a7e9f69",
  [safeRasterPath]: "5d3fa36bb3865110761752c978b811d0b44755e44a99376acf6c9f453af9af1e",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

for (const [path, expected] of Object.entries(expectedSources)) {
  const actual = sha256(readFileSync(path));
  if (actual !== expected) {
    throw new Error(`Brand source hash mismatch for ${path}: expected ${expected}, got ${actual}`);
  }
}

const sourceSvg = readFileSync(sourceSvgPath, "utf8");
const innerSvg = sourceSvg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
if (!innerSvg) throw new Error("Canonical Devil Phone SVG has no root content.");

const background = "#090d10";

function render(svg, width) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: false },
  }).render();
}

function squareSvg({ backgroundColor }) {
  // The recovered maskable raster places the canonical mark at 75% of the
  // canvas, centered. Preserve that exact safe-area composition for every
  // square derivative so horns, handset, tail, and arrow survive all masks.
  const inset = 387 * 0.125;
  const markSize = 387 * 0.75;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 387 387">
${backgroundColor ? `<rect width="387" height="387" fill="${backgroundColor}"/>` : ""}
<svg x="${inset}" y="${inset}" width="${markSize}" height="${markSize}" viewBox="0 0 387 387">
${innerSvg}
</svg>
</svg>`;
}

const crcTable = new Uint32Array(256);
for (let value = 0; value < 256; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  crcTable[value] = crc >>> 0;
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

/** Encodes Resvg RGBA pixels as opaque PNG truecolor (color type 2), with no metadata. */
function opaquePng(image) {
  const width = image.width;
  const height = image.height;
  const rgba = image.pixels;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = row + 1 + x * 3;
      const alpha = rgba[source + 3];
      if (alpha !== 255) throw new Error("Opaque brand render contains a non-opaque pixel.");
      raw[target] = rgba[source];
      raw[target + 1] = rgba[source + 1];
      raw[target + 2] = rgba[source + 2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const glyphs = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  N: ["10001", "11001", "10101", "10101", "10101", "10011", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
};

function pixelText(text, x, y, scale, color) {
  let cursor = x;
  const rectangles = [];
  for (const character of text) {
    if (character === " ") {
      cursor += scale * 4;
      continue;
    }
    const glyph = glyphs[character];
    if (!glyph) throw new Error(`No deterministic glyph for ${character}`);
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") {
          rectangles.push(
            `<rect x="${cursor + column * scale}" y="${y + row * scale}" width="${scale}" height="${scale}" fill="${color}"/>`,
          );
        }
      }
    }
    cursor += scale * 6;
  }
  return rectangles.join("");
}

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${background}"/>
<svg x="50" y="120" width="390" height="390" viewBox="0 0 387 387">${innerSvg}</svg>
${pixelText("SHARK", 485, 170, 18, "#f2f0e9")}
${pixelText("WEBHOOKS TO IPHONE", 485, 365, 6, "#b2b7ba")}
</svg>`;

const icon = opaquePng(render(squareSvg({ backgroundColor: background }), 1024));
const favicon = opaquePng(render(squareSvg({ backgroundColor: background }), 256));
const mark = render(squareSvg({}), 256).asPng();
const splash = render(squareSvg({}), 512).asPng();
const ogImage = opaquePng(render(ogSvg, 1200));

const generated = new Map([
  ["apps/expo/assets/icon.png", icon],
  ["apps/expo/assets/icon.svg", Buffer.from(sourceSvg)],
  ["apps/expo/assets/splash-icon.png", splash],
  ["apps/website/public/favicon.png", favicon],
  ["apps/website/public/app-store-icon.png", icon],
  ["apps/website/public/ogimage.png", ogImage],
  ["apps/website/src/client/assets/devil-phone-mark.png", mark],
]);

const manifest = {
  renderer: "@resvg/resvg-js@2.6.2",
  pngEncoding: "Node.js zlib level 9; PNG 8-bit truecolor; filter none; no ancillary metadata",
  background,
  sources: Object.fromEntries(
    Object.entries(expectedSources).map(([path, hash]) => [path.slice(root.length + 1), hash]),
  ),
  generated: Object.fromEntries(
    [...generated.entries()].map(([path, data]) => [path, sha256(data)]),
  ),
};
generated.set(
  "assets/brand/generated-assets.json",
  Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
);

let changed = false;
for (const [relativePath, data] of generated) {
  const path = resolve(root, relativePath);
  const existing = existsSync(path) ? readFileSync(path) : null;
  if (existing?.equals(data)) continue;
  changed = true;
  if (checkOnly) {
    console.error(`Brand asset is stale: ${relativePath}`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`wrote ${relativePath}`);
}

if (checkOnly && changed) process.exitCode = 1;
if (!changed) console.log("Brand assets are deterministic and current.");
