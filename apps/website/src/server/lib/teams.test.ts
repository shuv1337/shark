import { describe, expect, it } from "vitest";
import { errorClass } from "./teams";

describe("errorClass", () => {
  it("labels built-in error classes", () => {
    expect(errorClass(new Error("synthetic"))).toBe("Error");
    expect(errorClass(new TypeError("synthetic"))).toBe("TypeError");
    expect(errorClass(new RangeError("synthetic"))).toBe("RangeError");
    expect(errorClass(new AggregateError([], "synthetic"))).toBe("AggregateError");
  });

  it("never logs a thrower-controlled name", () => {
    const renamed = new Error("synthetic");
    renamed.name = "ExponentPushToken[synthetic-token]";
    expect(errorClass(renamed)).toBe("Error");

    class ProviderError extends TypeError {
      override name = "leaked synthetic-secret";
    }
    expect(errorClass(new ProviderError("synthetic"))).toBe("TypeError");

    const disguised = Object.assign(new Error("synthetic"), {
      constructor: { name: "synthetic-secret" },
    });
    expect(errorClass(disguised)).toBe("Error");
  });

  it("labels non-errors by type only", () => {
    expect(errorClass("synthetic-secret")).toBe("string");
    expect(errorClass({ message: "synthetic-secret" })).toBe("object");
    expect(errorClass(null)).toBe("null");
    expect(errorClass(undefined)).toBe("undefined");
  });
});
