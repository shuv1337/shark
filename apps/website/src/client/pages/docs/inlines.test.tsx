import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Inlines } from "./inlines";

describe("docs inline links", () => {
  /**
   * Installed, SHark has no browser chrome to come back with, so following a
   * link off this origin in place would strand the operator outside the app.
   */
  it("opens a link off this origin in a new tab", () => {
    const html = renderToStaticMarkup(
      <Inlines source="The source lives on [GitHub](https://github.com/shuv1337/shark/)." />,
    );
    expect(html).toContain('href="https://github.com/shuv1337/shark/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("keeps a link inside the app in the same tab", () => {
    const html = renderToStaticMarkup(<Inlines source="See [the board](/board)." />);
    expect(html).toContain('href="/board"');
    expect(html).not.toContain("target=");
  });

  it("keeps an anchor on the page in the same tab", () => {
    const html = renderToStaticMarkup(<Inlines source="Jump to [notify](#notify)." />);
    expect(html).toContain('href="#notify"');
    expect(html).not.toContain("target=");
  });
});
