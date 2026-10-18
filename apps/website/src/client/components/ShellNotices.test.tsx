// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConnection } from "../lib/connection";
import { ShellNotices } from "./ShellNotices";

/**
 * The shell's two self-reports: offline, and a new build waiting.
 *
 * The update helpers are stubbed because a real registration needs a real
 * worker; what matters here is that the bar appears when one is announced,
 * that Reload hands over to `applyUpdate`, and that neither of them reloads
 * the page out from under a half-typed answer.
 */
const applyUpdate = vi.fn(async () => true);
let announce: ((registration: ServiceWorkerRegistration) => void) | null = null;

vi.mock("../lib/pwaUpdate", () => ({
  applyUpdate: (...args: unknown[]) => applyUpdate(...(args as [])),
  onUpdateAvailable: (callback: (registration: ServiceWorkerRegistration) => void) => {
    announce = callback;
    return () => {
      announce = null;
    };
  },
}));

/**
 * Every build is served from the same `/sw.js`, so the waiting `ServiceWorker`
 * object is what tells two builds apart. Each call here is a distinct one.
 */
const build = (name: string) =>
  ({ waiting: { scriptURL: "/sw.js", name } }) as unknown as ServiceWorkerRegistration;

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: online });
}

describe("shell notices", () => {
  let container: HTMLDivElement;
  let root: Root;

  const text = () => container.textContent ?? "";
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find((node) =>
      (node.getAttribute("aria-label") ?? node.textContent ?? "").includes(label),
    );

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    applyUpdate.mockClear();
    announce = null;
    setOnline(true);
    resetConnection();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<ShellNotices />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    setOnline(true);
    resetConnection();
    vi.unstubAllGlobals();
  });

  describe("offline banner", () => {
    it("says nothing while the server is reachable", () => {
      expect(text()).toBe("");
    });

    it("appears when the browser goes offline and leaves when it returns", async () => {
      await act(async () => {
        setOnline(false);
        window.dispatchEvent(new Event("offline"));
      });
      expect(text()).toContain("You're offline. Showing what was last loaded.");

      await act(async () => {
        setOnline(true);
        window.dispatchEvent(new Event("online"));
      });
      expect(text()).not.toContain("You're offline");
    });

    /**
     * `navigator.onLine` stays true on a network that routes nowhere, so a
     * request that never reached the server is the signal that matters.
     */
    it("appears on a failed request even while the OS claims to be online", async () => {
      const { reportNetworkFailure, reportNetworkSuccess } = await import("../lib/connection");
      await act(async () => reportNetworkFailure());
      expect(text()).toContain("You're offline");
      await act(async () => reportNetworkSuccess());
      expect(text()).not.toContain("You're offline");
    });
  });

  describe("update bar", () => {
    it("stays away until a build is waiting", () => {
      expect(text()).not.toContain("SHark updated");
    });

    /**
     * A handover that is asked for and does not arrive must not leave the
     * button spinning on "Reloading…" for the rest of the session.
     */
    it("says a failed handover failed and offers it again", async () => {
      applyUpdate.mockRejectedValueOnce(new Error("did not take over in time"));
      await act(async () => announce?.(build("one")));
      await act(async () => button("Reload")?.click());

      expect(text()).toContain("That didn't go through.");
      const retry = button("Try again");
      expect(retry).toBeDefined();
      expect(retry?.disabled).toBe(false);

      await act(async () => retry?.click());
      expect(applyUpdate).toHaveBeenCalledTimes(2);
    });

    it("steps aside when there turned out to be nothing to apply", async () => {
      applyUpdate.mockResolvedValueOnce(false as never);
      await act(async () => announce?.(build("one")));
      await act(async () => button("Reload")?.click());
      expect(text()).not.toContain("SHark updated");
    });

    it("offers a reload that hands over to the waiting worker", async () => {
      await act(async () => announce?.(build("one")));
      expect(text()).toContain("SHark updated.");

      await act(async () => button("Reload")?.click());
      expect(applyUpdate).toHaveBeenCalledOnce();
    });

    it("is a bar, not a dialog", async () => {
      await act(async () => announce?.(build("one")));
      expect(container.querySelector("[role='dialog']")).toBeNull();
      expect(container.querySelector("[role='status']")).not.toBeNull();
    });

    it("can be dismissed and does not come back for the same build", async () => {
      const one = build("one");
      await act(async () => announce?.(one));
      await act(async () => button("Dismiss the update notice")?.click());
      expect(text()).not.toContain("SHark updated");

      await act(async () => announce?.(one));
      expect(text()).not.toContain("SHark updated");
    });

    /**
     * On a tab left open for days, dismissing once must not mean never being
     * told again: a later build is a new offer.
     */
    it("comes back for a newer build after a dismissal", async () => {
      await act(async () => announce?.(build("one")));
      await act(async () => button("Dismiss the update notice")?.click());
      expect(text()).not.toContain("SHark updated");

      await act(async () => announce?.(build("two")));
      expect(text()).toContain("SHark updated.");

      // And that one can be dismissed on its own terms.
      await act(async () => button("Dismiss the update notice")?.click());
      expect(text()).not.toContain("SHark updated");
    });

    /**
     * Reloading discards whatever is typed, so an update that arrives while an
     * answer is being written waits for the field to be left. The answer is
     * the only thing on this page that cannot be recovered by loading it again.
     */
    it("waits while an ask field has focus, then shows itself", async () => {
      const ask = document.createElement("article");
      ask.dataset.askId = "bask_synthetic";
      const reply = document.createElement("textarea");
      ask.append(reply);
      document.body.append(ask);
      reply.focus();

      await act(async () => announce?.(build("one")));
      expect(text()).not.toContain("SHark updated");
      expect(applyUpdate).not.toHaveBeenCalled();

      await act(async () => {
        reply.blur();
        reply.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(text()).toContain("SHark updated.");
      ask.remove();
    });
  });
});
