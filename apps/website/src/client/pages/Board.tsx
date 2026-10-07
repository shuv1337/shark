import type { BoardAskDto, BoardAskEventDto, BoardPageDto } from "@hark/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { BrandWordmark } from "../components/BrandWordmark";
import { AskCard } from "../components/board/AskCard";
import { CrewStrip, Lane, NoteCard, WorkCard } from "../components/board/Cards";
import { api } from "../lib/api";
import { signOut, useSession } from "../lib/auth";
import { subscribeToBoardUpdates } from "../lib/boardUpdates";

/** Whether this page runs inside the SHark iPhone web view, which has no chrome of its own. */
function inWebView(): boolean {
  return typeof window !== "undefined" && "hark" in window;
}

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
      navigate("/", { replace: true });
      return;
    }
    if (session) void refresh();
  }, [session, isPending, navigate, refresh]);

  useEffect(() => {
    if (!session) return;
    return subscribeToBoardUpdates(() => void refresh());
  }, [session, refresh]);

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
    return <div className="flex min-h-dvh items-center justify-center text-ink-faint">…</div>;
  }

  const fresh = page?.waiting.filter((ask) => !ask.aged) ?? [];
  const aged = page?.waiting.filter((ask) => ask.aged) ?? [];
  const embedded = inWebView();

  return (
    <div className="min-h-dvh">
      {embedded ? null : (
        <header>
          <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-4 sm:px-6">
            <Link className="text-lg font-semibold" to="/">
              <BrandWordmark />
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              <Link className="text-ink-subtle transition hover:text-ink" to="/dashboard">
                Dashboard
              </Link>
              <button
                className="min-h-9 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-muted shadow-xs transition-colors hover:bg-surface-hover"
                onClick={() => void signOut().then(() => navigate("/"))}
                type="button"
              >
                Sign out
              </button>
            </nav>
          </div>
        </header>
      )}

      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
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
          <button
            className="min-h-9 rounded-full border border-line px-3 text-xs font-medium text-ink-muted transition hover:bg-surface-hover"
            onClick={() => void refresh()}
            type="button"
          >
            Refresh
          </button>
        </div>

        {error ? (
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
              <Link className="text-xs font-medium text-accent-text" to="/board">
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
                  className="text-sm font-medium text-ink-subtle hover:text-ink"
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
        ) : error ? null : (
          <p className="mt-8 text-sm text-ink-faint">Loading the board…</p>
        )}
      </main>
    </div>
  );
}
