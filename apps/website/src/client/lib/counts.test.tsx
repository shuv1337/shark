// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  COUNTS_POLL_INTERVAL_MS,
  clearNavCounts,
  publishBoardWaiting,
  refreshInboxCounts,
  resetNavCounts,
  useNavCounts,
} from "./counts";

vi.mock("./api", () => ({
  api: {
    getBoard: vi.fn(async () => ({ waiting: [] })),
    getInboxCounts: vi.fn(async () => ({ unread: 0, needsAction: 0 })),
  },
}));

/** One subscriber, rendering the counts it is given. */
function Badge({ enabled = true }: { enabled?: boolean }) {
  const counts = useNavCounts(enabled);
  return (
    <p>
      {counts.boardWaiting}/{counts.inboxUnread}/{counts.inboxNeedsAction}
    </p>
  );
}

describe("navigation counts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let worker: EventTarget;

  const mount = async (node: React.ReactNode) => {
    await act(async () => root.render(node));
  };
  const shown = () => container.textContent;
  const push = async () => {
    await act(async () => {
      worker.dispatchEvent(new MessageEvent("message", { data: { type: "hark:inbox-updated" } }));
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    worker = new EventTarget();
    vi.stubGlobal("navigator", { serviceWorker: worker });
    resetNavCounts();
    vi.mocked(api.getBoard)
      .mockReset()
      .mockResolvedValue({ waiting: [{ id: "bask_1" }, { id: "bask_2" }] } as never);
    vi.mocked(api.getInboxCounts).mockReset().mockResolvedValue({ unread: 4, needsAction: 1 });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    resetNavCounts();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads both counts once for every subscriber on the page", async () => {
    await mount(
      <>
        <Badge />
        <Badge />
        <Badge />
      </>,
    );

    expect(api.getBoard).toHaveBeenCalledTimes(1);
    expect(api.getInboxCounts).toHaveBeenCalledTimes(1);
    // Every subscriber shows the same numbers.
    expect(shown()).toBe("2/4/12/4/12/4/1");
  });

  it("polls once for the whole page, not once per subscriber", async () => {
    await mount(
      <>
        <Badge />
        <Badge />
      </>,
    );
    await act(async () => {
      vi.advanceTimersByTime(COUNTS_POLL_INTERVAL_MS);
    });
    expect(api.getBoard).toHaveBeenCalledTimes(2);
    expect(api.getInboxCounts).toHaveBeenCalledTimes(2);
  });

  it("stops reading once the last subscriber leaves", async () => {
    await mount(
      <>
        <Badge />
        <Badge />
      </>,
    );
    // One subscriber leaving is not the last one.
    await mount(<Badge />);
    await act(async () => {
      vi.advanceTimersByTime(COUNTS_POLL_INTERVAL_MS);
    });
    expect(api.getBoard).toHaveBeenCalledTimes(2);

    await mount(<p>nothing subscribed</p>);
    await act(async () => {
      vi.advanceTimersByTime(COUNTS_POLL_INTERVAL_MS * 3);
    });
    await push();
    expect(api.getBoard).toHaveBeenCalledTimes(2);
  });

  it("re-reads when a push arrives and when the tab is resumed", async () => {
    await mount(<Badge />);
    expect(api.getInboxCounts).toHaveBeenCalledTimes(1);

    await push();
    expect(api.getInboxCounts).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.getInboxCounts).toHaveBeenCalledTimes(3);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(api.getInboxCounts).toHaveBeenCalledTimes(4);
  });

  it("requests nothing at all while signed out", async () => {
    await mount(<Badge enabled={false} />);
    await act(async () => {
      vi.advanceTimersByTime(COUNTS_POLL_INTERVAL_MS * 2);
    });
    await push();

    expect(api.getBoard).not.toHaveBeenCalled();
    expect(api.getInboxCounts).not.toHaveBeenCalled();
    expect(shown()).toBe("0/0/0");
  });

  it("takes a count a page publishes, and keeps the last good one on failure", async () => {
    await mount(<Badge />);
    expect(shown()).toBe("2/4/1");

    await act(async () => publishBoardWaiting(7));
    expect(shown()).toBe("7/4/1");

    vi.mocked(api.getInboxCounts).mockResolvedValue({ unread: 0, needsAction: 1 });
    await act(async () => refreshInboxCounts());
    expect(shown()).toBe("7/0/1");

    vi.mocked(api.getInboxCounts).mockRejectedValue(new Error("offline"));
    await act(async () => refreshInboxCounts());
    expect(shown()).toBe("7/0/1");
  });
});

/**
 * The number on the installed app's icon. It is the sum of the two things
 * waiting on the operator, cleared rather than drawn as a zero, and never
 * called at all where the Badging API does not exist — Safari on the desktop
 * and every browser that is not installed.
 */
describe("app badge", () => {
  let container: HTMLDivElement;
  let root: Root;
  let setAppBadge: ReturnType<typeof vi.fn>;
  let clearAppBadge: ReturnType<typeof vi.fn>;

  const badging = (supported: boolean) => {
    vi.stubGlobal("navigator", {
      serviceWorker: new EventTarget(),
      ...(supported ? { setAppBadge, clearAppBadge } : {}),
    });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    setAppBadge = vi.fn(async () => {});
    clearAppBadge = vi.fn(async () => {});
    badging(true);
    resetNavCounts();
    vi.mocked(api.getBoard)
      .mockReset()
      .mockResolvedValue({ waiting: [] } as never);
    vi.mocked(api.getInboxCounts).mockReset().mockResolvedValue({ unread: 0, needsAction: 0 });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    resetNavCounts();
    vi.unstubAllGlobals();
  });

  /**
   * The badge outlives the page. A load that reads zero and zero changes
   * nothing in memory, so keying the paint off a change would leave the
   * previous session's number sitting on the icon until something else moved.
   */
  it("clears a badge left by a previous session once both counts read zero", async () => {
    await act(async () => root.render(<Badge />));
    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it("paints nothing until both sources have actually reported", async () => {
    // Only the board has answered; the inbox total is still unknown, and
    // guessing it is zero would flash the wrong number on the icon.
    await act(async () => publishBoardWaiting(3));
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).not.toHaveBeenCalled();

    await act(async () => root.render(<Badge />));
    expect(setAppBadge).toHaveBeenLastCalledWith(3);
  });

  it("badges the board and the inbox together whenever either changes", async () => {
    await act(async () => root.render(<Badge />));

    await act(async () => publishBoardWaiting(2));
    expect(setAppBadge).toHaveBeenLastCalledWith(2);

    vi.mocked(api.getInboxCounts).mockResolvedValue({ unread: 3, needsAction: 0 });
    await act(async () => refreshInboxCounts());
    expect(setAppBadge).toHaveBeenLastCalledWith(5);
  });

  /** Needs-action is a dot in the navigation, never a second count here. */
  it("leaves needs-action out of the number", async () => {
    await act(async () => root.render(<Badge />));
    vi.mocked(api.getInboxCounts).mockResolvedValue({ unread: 1, needsAction: 4 });
    await act(async () => refreshInboxCounts());
    expect(setAppBadge).toHaveBeenLastCalledWith(1);
  });

  it("clears the badge at zero rather than drawing a 0", async () => {
    await act(async () => root.render(<Badge />));
    await act(async () => publishBoardWaiting(1));
    expect(setAppBadge).toHaveBeenLastCalledWith(1);

    await act(async () => publishBoardWaiting(0));
    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenLastCalledWith(0);
  });

  it("clears the badge and the counts on sign-out", async () => {
    await act(async () => root.render(<Badge />));
    await act(async () => publishBoardWaiting(4));
    clearAppBadge.mockClear();

    await act(async () => clearNavCounts());
    expect(clearAppBadge).toHaveBeenCalledOnce();
    expect(container.textContent).toBe("0/0/0");
  });

  /**
   * Sign-out happens with reads in the air. One landing afterwards would put
   * the badge back on a browser that is no longer signed in.
   */
  it("keeps the badge cleared when a read started before sign-out lands after it", async () => {
    let settle: ((value: { waiting: unknown[] }) => void) | undefined;
    vi.mocked(api.getBoard).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve as typeof settle;
      }) as never,
    );
    vi.mocked(api.getInboxCounts).mockResolvedValue({ unread: 7, needsAction: 0 });

    await act(async () => root.render(<Badge />));
    setAppBadge.mockClear();
    clearAppBadge.mockClear();

    await act(async () => clearNavCounts());
    expect(clearAppBadge).toHaveBeenCalledOnce();

    // The read from before the sign-out finally answers.
    await act(async () => {
      settle?.({ waiting: [{ id: "bask_1" }, { id: "bask_2" }] });
    });
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(container.textContent).toBe("0/0/0");
  });

  /** The board page publishes from an effect, which can also run late. */
  it("ignores a board count published after sign-out", async () => {
    await act(async () => root.render(<Badge />));
    await act(async () => clearNavCounts());
    setAppBadge.mockClear();

    await act(async () => publishBoardWaiting(5));
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(container.textContent).toBe("0/0/0");
  });

  /** A browser may have the API and still refuse the call. */
  it("survives a badge the browser rejects", async () => {
    setAppBadge.mockRejectedValue(new Error("not allowed"));
    await act(async () => root.render(<Badge />));
    await act(async () => publishBoardWaiting(2));
    expect(setAppBadge).toHaveBeenCalledWith(2);
    // No unhandled rejection, and the counts are still live.
    expect(container.textContent).toBe("2/0/0");
  });

  it("never calls the API where the browser does not have it", async () => {
    badging(false);
    await act(async () => root.render(<Badge />));
    await act(async () => publishBoardWaiting(3));
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).not.toHaveBeenCalled();
  });
});
