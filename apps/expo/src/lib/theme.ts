export const colors = {
  paper: "#FAFAF9",
  surface: "#FFFFFF",
  ink: "#171713",
  muted: "#6B6A63",
  soft: "#A3A199",
  line: "#E7E5E0",
  accent: "#035B49",
  accentPressed: "#02493B",
  accentSoft: "#E7F0ED",
  danger: "#C93B2C",
} as const;

export const fonts = {
  regular: "InterTight_400Regular",
  medium: "InterTight_500Medium",
  semibold: "InterTight_600SemiBold",
  mono: "Menlo",
} as const;

/**
 * Inter Tight already carries display spacing, so text keeps its native
 * tracking and only large headings tighten by 1%. React Native measures
 * letterSpacing in points.
 */
export const tightTracking = (fontSize: number) => (fontSize >= 24 ? fontSize * -0.01 : 0);
