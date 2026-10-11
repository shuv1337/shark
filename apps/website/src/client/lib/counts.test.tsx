// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  COUNTS_POLL_INTERVAL_MS,
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
