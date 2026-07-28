import { describe, expect, it } from "vitest";
import { isEmailAllowed } from "./admission";

describe("account admission", () => {
  const allowed = ["operator@example.com", "relay@privaterelay.appleid.com"];

  it("matches exact normalized real and Apple relay addresses", () => {
    expect(isEmailAllowed(" Operator@Example.com ", allowed)).toBe(true);
    expect(isEmailAllowed("RELAY@privaterelay.appleid.com", allowed)).toBe(true);
  });

  it("does not infer aliases, relay mappings, or domains", () => {
    expect(isEmailAllowed("other@example.com", allowed)).toBe(false);
    expect(isEmailAllowed("operator+alias@example.com", allowed)).toBe(false);
    expect(isEmailAllowed("relay@icloud.com", allowed)).toBe(false);
  });
});
