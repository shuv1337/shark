import { type ColorValue, DynamicColorIOS, Platform } from "react-native";

export const lightColors = {
  paper: "#FAFAF9",
  surface: "#FFFFFF",
  ink: "#171713",
  muted: "#6B6A63",
  soft: "#A3A199",
  line: "#E7E5E0",
  accent: "#B64E36",
  accentPressed: "#9F422F",
  accentSoft: "rgba(182, 78, 54, 0.10)",
  accentForeground: "#FFFFFF",
  danger: "#C93B2C",
  warning: "#D48A16",
  appleButtonForeground: "#FFFFFF",
} as const;

/**
 * The complete palette follows Shuv2Code: warm red actions over navy surfaces.
 */
export const darkColors: Record<keyof typeof lightColors, string> = {
  paper: "#0C1119",
  surface: "#0F1621",
  ink: "#E7ECF3",
  muted: "#B9C3D1",
  soft: "#8995A6",
  line: "rgba(255, 255, 255, 0.06)",
  accent: "#D35C46",
  accentPressed: "#E06A54",
  accentSoft: "rgba(211, 92, 70, 0.18)",
  accentForeground: "#0C1119",
  danger: "#FCA5A5",
  warning: "#FFB44A",
  appleButtonForeground: "#111111",
} as const;

export type ThemeColorName = keyof typeof lightColors;
export type AppColors = Readonly<Record<ThemeColorName, ColorValue>>;

function adaptiveColor(name: ThemeColorName): ColorValue {
  if (Platform.OS !== "ios") return lightColors[name];
  return DynamicColorIOS({
    light: lightColors[name],
    dark: darkColors[name],
    highContrastLight: lightColors[name],
    highContrastDark: darkColors[name],
  });
}

export const colors = Object.fromEntries(
  (Object.keys(lightColors) as ThemeColorName[]).map((name) => [name, adaptiveColor(name)]),
) as AppColors;

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  mono: "Menlo",
} as const;

/** React Native letterSpacing is measured in points, so convert -2% per size. */
export const tightTracking = (fontSize: number) => fontSize * -0.02;
