import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelfHostedBadge } from "./Dashboard";

describe("self-hosted dashboard state", () => {
  it("renders a fixed self-hosted label without paid or metered copy", () => {
    const html = renderToStaticMarkup(<SelfHostedBadge />);
    expect(html).toContain("Self-hosted");
    expect(html).not.toMatch(/free|pro|upgrade|checkout|remaining|100,000/i);
  });
});
