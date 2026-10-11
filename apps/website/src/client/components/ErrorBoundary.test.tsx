// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  const error = new Error("operator@example.test has 3 unread notifications");
  error.name = "RenderFailure";
  throw error;
}

describe("error boundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders its children while nothing is wrong", async () => {
    await act(async () => root.render(<ErrorBoundary>healthy app</ErrorBoundary>));
    expect(container.textContent).toContain("healthy app");
  });

  it("shows a recovery action and the error name only", async () => {
    await act(async () =>
      root.render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      ),
    );

    expect(container.textContent).toContain("SHark stopped unexpectedly");
    expect(container.textContent).toContain("RenderFailure");
    const reload = [...container.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Reload SHark"),
    );
    expect(reload).toBeDefined();
    // Error messages can carry notification content; the screen must not leak it.
    expect(container.textContent).not.toContain("operator@example.test");
    expect(container.textContent).not.toContain("unread notifications");
  });
});
