import { describe, expect, it } from "vitest";
import { BRAND } from "./brand";
import { absoluteUrl, PAGE_SEO, PRIVATE_PAGES, seoPageForPath } from "./seo";

describe("private SHark metadata", () => {
  it("marks every human-facing page noindex and uses the SHark origin", () => {
    for (const page of PRIVATE_PAGES) {
      expect(PAGE_SEO[page].index).toBe(false);
      expect(absoluteUrl(PAGE_SEO[page].path)).toMatch(/^https:\/\/shark\.shuv\.dev\//);
    }
    expect(BRAND.productName).toBe("SHark");
  });

  it("resolves known routes without treating unknown paths as pages", () => {
    expect(seoPageForPath("/")).toBe("home");
    expect(seoPageForPath("/docs/")).toBe("docs");
    expect(seoPageForPath("/dashboard")).toBe("dashboard");
    expect(seoPageForPath("/pricing")).toBeNull();
    expect(seoPageForPath("/missing")).toBeNull();
  });
});
