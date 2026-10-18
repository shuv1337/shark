import type { BoardAskDto, BoardAskEventDto, BoardPageDto } from "@hark/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AskCard } from "../components/board/AskCard";
import { CrewStrip, Lane, NoteCard, WorkCard } from "../components/board/Cards";
import { SkeletonList } from "../components/DashboardKit";
import { quietButton } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../lib/auth";
import { subscribeToBoardUpdates } from "../lib/boardUpdates";
import { subscribeToReconnect, useOffline } from "../lib/connection";
import { publishBoardWaiting } from "../lib/counts";

export function Board() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [page, setPage] = useState<BoardPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<{ ask: BoardAskDto; events: BoardAskEventDto[] } | null>(
    null,
  );
  const [showAged, setShowAged] = useState(false);
  const request = useRef(0);
  /*
   * Offline, the shell already says the page is showing what was last loaded.
   * Repeating it here as a red "Could not load the board" would be both
   * redundant and wrong: the board underneath it is real, just not current.
   */
  const offline = useOffline();

  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const next = await api.getBoard();
      if (current !== request.current) return;
      setPage(next);
      setError(null);
    } catch (reason) {
      if (current !== request.current) return;
      setError(reason instanceof Error ? reason.message : "Could not load the board");
    }
  }, []);

  useEffect(() => {
    if (!isPending && !session) {
      // navigate() can return a promise; the router owns navigation errors.
      void navigate("/", { replace: true });
      return;
    }
    if (session) void refresh();
  }, [session, isPending, navigate, refresh]);

  useEffect(() => {
    if (!session) return;
    return subscribeToBoardUpdates(() => void refresh());
  }, [session, refresh]);

  /*
   * Back online: drop the error this page stopped showing while the shell's
   * banner was up, and read again. Without this the error would simply
   * reappear as the banner left, over data that is about to be replaced.
   */
  useEffect(
    () =>
      subscribeToReconnect(() => {
        setError(null);
        void refresh();
      }),
    [refresh],
  );

  // A deep link from a push shows that ask first, with its timeline, even once
  // resolved. It reloads whenever the board changes so its state stays current.
  const focusKey = `${params.id ?? ""}\u0000${page?.cursor ?? ""}`;
  useEffect(() => {
    const [id] = focusKey.split("\u0000");
    if (!session || !id) {
      setFocused(null);
      return;
    }
    let cancelled = false;
    void api
      .getBoardAsk(id)
      .then((result) => {
        if (!cancelled) setFocused(result);
      })
      .catch(() => {
        if (!cancelled) setFocused(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, focusKey]);

  const waitingCount = page?.waiting.length ?? 0;
  useEffect(() => {
    document.title = waitingCount > 0 ? `(${waitingCount}) Board — SHark` : "Board — SHark";
  }, [waitingCount]);

  /*
   * The board's own stream is the fastest signal this number has, and
   * answering, snoozing or dismissing an ask drops it from the lane here
   * first. Publishing from the loaded page keeps the nav badge on that signal
   * instead of its own slower poll. `page` rather than the count alone, so a
   * board that has not loaded yet never zeroes a badge the store just read.
   */
  useEffect(() => {
    if (page) publishBoardWaiting(page.waiting.length);
  }, [page]);

  const replaceAsk = (ask: BoardAskDto) => {
    setPage((current) => {
      if (!current) return current;
      const swap = (list: BoardAskDto[]) => list.map((item) => (item.id === ask.id ? ask : item));
      const stillWaiting = ask.status === "open";
      return {
        ...current,
        waiting: stillWaiting
          ? swap(current.waiting)
          : current.waiting.filter((item) => item.id !== ask.id),
        withAgent: stillWaiting
          ? current.withAgent
          : current.withAgent.some((item) => item.id === ask.id)
            ? swap(current.withAgent)
            : [ask, ...current.withAgent],
      };
    });
    setFocused((current) => (current && current.ask.id === ask.id ? { ...current, ask } : current));
    void refresh();
  };

  if (isPending || !session) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6">
        <SkeletonList label="Loading the board" rowClassName="h-28" rows={3} />
      </main>
    );
  }

  const fresh = page?.waiting.filter((ask) => !ask.aged) ?? [];
  const aged = page?.waiting.filter((ask) => ask.aged) ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Board</h1>
          <p className="mt-1 text-sm text-ink-subtle">
            {waitingCount === 0
              ? "Nothing is waiting on you."
              : waitingCount === 1
                ? "One thing is waiting on you."
                : `${waitingCount} things are waiting on you.`}
          </p>
        </div>
        <button className={quietButton} onClick={() => void refresh()} type="button">
          Refresh
        </button>
      </div>

      {error && !offline ? (
        <p className="mt-4 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {page ? (
        <div className="mt-4">
          <CrewStrip crew={page.crew} />
        </div>
      ) : null}

      {focused ? (
        <section aria-labelledby="focused-heading" className="mt-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-ink" id="focused-heading">
              From your notification
            </h2>
            <Link className={`${quietButton} text-accent-text`} to="/board">
              Whole board
            </Link>
          </div>
          <AskCard ask={focused.ask} events={focused.events} expanded onChanged={replaceAsk} />
        </section>
      ) : null}

      {page ? (
        <div className="mt-8">
          <Lane
            count={fresh.length}
            empty="Your agents have no open questions."
            id="waiting"
            title="Waiting on you"
          >
            <div className="flex flex-col gap-3">
              {fresh
                .filter((ask) => ask.id !== focused?.ask.id)
                .map((ask) => (
                  <AskCard ask={ask} key={ask.id} onChanged={replaceAsk} />
                ))}
            </div>
          </Lane>

          {aged.length > 0 ? (
            <section className="mt-6">
              <button
                aria-expanded={showAged}
                className={`${quietButton} px-0 text-sm hover:bg-transparent`}
                onClick={() => setShowAged((value) => !value)}
                type="button"
              >
                {showAged ? "Hide" : "Show"} {aged.length} older{" "}
                {aged.length === 1 ? "question" : "questions"} still open
              </button>
              {showAged ? (
                <div className="mt-3 flex flex-col gap-3">
                  {aged.map((ask) => (
                    <AskCard ask={ask} key={ask.id} onChanged={replaceAsk} />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <Lane
            count={page.withAgent.length}
            empty="Every answer has reached its agent."
            id="with-agent"
            title="Answered, with the agent"
          >
            <div className="flex flex-col gap-3">
              {page.withAgent.map((ask) => (
                <AskCard ask={ask} key={ask.id} onChanged={replaceAsk} />
              ))}
            </div>
          </Lane>

          <Lane
            count={page.inFlight.length}
            empty="Nothing is running."
            id="in-flight"
            title="In flight"
          >
            <div className="flex flex-col gap-3">
              {page.inFlight.map((item) => (
                <WorkCard item={item} key={item.id} />
              ))}
            </div>
          </Lane>

          <Lane count={page.queued.length} empty="The queue is empty." id="queued" title="Queued">
            <div className="flex flex-col gap-3">
              {page.queued.map((item) => (
                <WorkCard item={item} key={item.id} />
              ))}
            </div>
          </Lane>

          <Lane count={page.notes.length} empty="No heads-up notes." id="notes" title="Heads-up">
            <div className="flex flex-col gap-3">
              {page.notes.map((note) => (
                <NoteCard key={note.id} note={note} />
              ))}
            </div>
          </Lane>

          <Lane
            count={page.done.length}
            empty="Nothing finished in the last two weeks."
            id="done"
            title="Recently done"
          >
            <div className="flex flex-col gap-3">
              {page.done.map((entry) =>
                entry.kind === "work" ? (
                  <WorkCard item={entry.item} key={entry.item.id} />
                ) : (
                  <AskCard ask={entry.item} key={entry.item.id} onChanged={replaceAsk} />
                ),
              )}
            </div>
          </Lane>
        </div>
      ) : offline ? (
        // A cold start with no connection: the shell opened from the cache and
        // there is genuinely nothing to show yet. A skeleton here would
        // pretend something is on its way.
        <p className="mt-8 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center text-ink-muted">
          The board has not loaded in this browser yet. It will fill in when you're back online.
        </p>
      ) : error ? null : (
        <SkeletonList className="mt-8" label="Loading the board" rowClassName="h-28" rows={3} />
      )}
    </main>
  );
}
