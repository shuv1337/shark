import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserNotifications, SelfHostedBadge } from "./Dashboard";

describe("self-hosted dashboard state", () => {
  it("renders a fixed self-hosted label without paid or metered copy", () => {
    const html = renderToStaticMarkup(<SelfHostedBadge />);
    expect(html).toContain("Self-hosted");
    expect(html).not.toMatch(/free|pro|upgrade|checkout|remaining|100,000/i);
  });
});

describe("browser notification dashboard state", () => {
  it("renders a stable checking state before browser capability detection", () => {
    const html = renderToStaticMarkup(<BrowserNotifications />);
    expect(html).toContain("This browser");
    expect(html).toContain("Desktop notifications");
    expect(html).toContain("Checking notification support");
    expect(html).not.toContain("Enable notifications");
  });
});
