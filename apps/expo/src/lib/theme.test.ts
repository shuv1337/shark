import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  DynamicColorIOS: (value: unknown) => value,
  Platform: { OS: "ios" },
}));

import { colors, darkColors, lightColors } from "./theme";

function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) => {
    if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected six-digit hex: ${hex}`);
    const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(
      (channel) => Number.parseInt(channel, 16) / 255,
    ) as [number, number, number];
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    ) as [number, number, number];
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  const brighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

describe("app theme palettes", () => {
  it("keeps light and dark palettes semantically complete", () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it("uses the Shuv2Code dark neutral foundation with a contrast-safe SHark accent", () => {
    expect(darkColors).toMatchObject({
      paper: "#0C1119",
      surface: "#0F1621",
      ink: "#E7ECF3",
      muted: "#B9C3D1",
      soft: "#8995A6",
      accent: "#5ED8B7",
      accentForeground: "#0C1119",
    });
  });

  it("registers each semantic color as an adaptive iOS color", () => {
    expect(colors.paper).toEqual({
      light: lightColors.paper,
      dark: darkColors.paper,
      highContrastLight: lightColors.paper,
      highContrastDark: darkColors.paper,
    });
    expect(colors.accentForeground).toEqual({
      light: lightColors.accentForeground,
      dark: darkColors.accentForeground,
      highContrastLight: lightColors.accentForeground,
      highContrastDark: darkColors.accentForeground,
    });
  });

  it("keeps primary text and action labels at accessible contrast", () => {
    for (const palette of [lightColors, darkColors]) {
      expect(contrastRatio(palette.ink, palette.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.accentForeground, palette.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
