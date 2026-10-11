import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contrast guard for the status colours that are painted as *text on their own
 * tint*, which is the weakest combination in the palette and the one that is
 * easiest to regress by nudging a token's lightness.
 *
 * The numbers come from the token values in `index.css`, so changing a token
 * moves this test rather than leaving it stale.
 */

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

/** The `@theme` block holds the light values; the dark media query remaps them. */
function token(name: string, scheme: "light" | "dark"): [number, number, number] {
  const darkBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
  const source = scheme === "dark" ? darkBlock : css.slice(0, css.indexOf("@media"));
  const match = new RegExp(`${name}:\\s*oklch\\(([^)]+)\\)`).exec(source);
  if (!match?.[1]) throw new Error(`No oklch value for ${name} in the ${scheme} scheme`);
  const [l, c, h] = match[1].trim().split(/\s+/).map(Number);
  return [l ?? 0, c ?? 0, h ?? 0];
}

/** oklch -> linear sRGB (Björn Ottosson's matrices). */
function toLinearRgb([L, C, H]: [number, number, number]): number[] {
  const hue = (H * Math.PI) / 180;
  const a = C * Math.cos(hue);
  const b = C * Math.sin(hue);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Linear sRGB -> the 8-bit channels a browser actually paints. */
function toSrgb8(linear: number[]): number[] {
  return linear.map((channel) => {
    const clamped = Math.max(0, Math.min(1, channel));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
}

function relativeLuminance(rgb8: number[]): number {
  const [r = 0, g = 0, b = 0] = rgb8.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: number[], background: number[]): number {
  const [high, low] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/** `bg-ok/14` is the token at 14% over whatever sits behind it. */
function composite(foreground: number[], background: number[], alpha: number): number[] {
  return foreground.map((channel, index) =>
    Math.round(channel * alpha + (background[index] ?? 0) * (1 - alpha)),
  );
}

const colour = (name: string, scheme: "light" | "dark") =>
  toSrgb8(toLinearRgb(token(name, scheme)));

describe("status token contrast", () => {
  // Badge paints `text-ok` on `bg-ok/14`, inside a card or on a panel.
  it.each([
    ["light", "--color-surface"],
    ["light", "--color-panel"],
    ["dark", "--color-surface"],
    ["dark", "--color-panel"],
  ] as const)("ok reads on its own tint over %s %s", (scheme, surface) => {
    const ok = colour("--color-ok", scheme);
    const behind = colour(surface, scheme);
    expect(contrast(ok, composite(ok, behind, 0.14))).toBeGreaterThanOrEqual(4.5);
  });

  it("pins the ok lightness that earns that contrast", () => {
    expect(token("--color-ok", "light")[0]).toBeLessThanOrEqual(0.46);
    expect(token("--color-ok", "dark")[0]).toBeGreaterThanOrEqual(0.78);
  });

  it("computes contrast the way a checker does", () => {
    // Sanity anchors: white on white is 1:1, black on white is 21:1.
    expect(contrast([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });
});
