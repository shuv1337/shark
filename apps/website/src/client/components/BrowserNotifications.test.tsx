import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SelfHostedBadge } from "./AppShell";
import { BrowserNotifications } from "./BrowserNotifications";

describe("self-hosted settings state", () => {
  it("renders a fixed self-hosted label without paid or metered copy", () => {
    const html = renderToStaticMarkup(<SelfHostedBadge />);
    expect(html).toContain("Self-hosted");
    expect(html).not.toMatch(/free|pro|upgrade|checkout|remaining|100,000/i);
  });
});

describe("browser notification settings state", () => {
  it("renders a stable checking state before browser capability detection", () => {
    const html = renderToStaticMarkup(<BrowserNotifications />);
    expect(html).toContain("Browser notifications");
    expect(html).toContain("Desktop alerts for this browser");
    expect(html).toContain("Checking notification support");
    expect(html).not.toContain("Enable notifications");
  });

  it("anchors itself for the settings section rail", () => {
    const html = renderToStaticMarkup(<BrowserNotifications />);
    expect(html).toContain('id="notifications"');
  });
});
