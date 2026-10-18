import { describe, expect, it } from "vitest";
import {
  dangerButtonSmall,
  primaryButton,
  primaryButtonSmall,
  quietButton,
  rowButton,
  rowDangerButton,
  secondaryButton,
} from "./ui";

const FIXED_HEIGHT_CONTROLS = {
  primaryButton,
  primaryButtonSmall,
  secondaryButton,
  rowButton,
  rowDangerButton,
  dangerButtonSmall,
  quietButton,
};

describe("shared controls", () => {
  /**
   * These are all `h-8`/`h-9`/`h-11`, so a label that wrapped to a second line
   * would render outside its own pill. "New service" did exactly that in the
   * dashboard header at phone widths.
   */
  it.each(Object.entries(FIXED_HEIGHT_CONTROLS))(
    "%s keeps its label on one line",
    (_name, classes) => {
      expect(classes).toMatch(/\bh-(8|9|11)\b/);
      expect(classes).toContain("whitespace-nowrap");
    },
  );

  it.each(Object.entries(FIXED_HEIGHT_CONTROLS))("%s has hover, focus and disabled", (_n, c) => {
    expect(c).toContain("hover:");
    expect(c).toContain("focus-visible:outline-accent");
    expect(c).toContain("disabled:");
  });
});
