import type { BoardAskDto, BoardAskEventDto } from "@hark/contracts";
import { useState } from "react";
import { ApiRequestError, api } from "../../lib/api";
import {
  answerSummary,
  defaultLaterDate,
  deliveryLabel,
  kindLabel,
  priorityClass,
  priorityLabel,
  relativeTime,
} from "./format";

type Busy = "idle" | "answering" | "snoozing" | "dismissing";

export function AgentChip({ agent, display }: { agent: string; display: string | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-muted">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
      <span className="truncate">{display ? `${agent} · ${display}` : agent}</span>
    </span>
  );
}

export function LinkChips({ links }: { links: BoardAskDto["links"] }) {
  if (links.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {links.map((link) => (
        <a
          className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted transition hover:bg-surface-hover hover:text-ink"
          href={link.url}
          key={link.url}
          rel="noreferrer"
          target="_blank"
        >
          {link.label ?? linkFallbackLabel(link)}
        </a>
      ))}
    </span>
  );
}

function linkFallbackLabel(link: BoardAskDto["links"][number]): string {
  try {
    const url = new URL(link.url);
    const path = url.pathname.replace(/\/+$/, "");
    const tail = path.split("/").slice(-2).join("/");
    return link.kind === "other" ? url.host : `${link.kind}${tail ? ` ${tail}` : ""}`;
  } catch {
    return link.kind;
  }
}

function optionClass(style: BoardAskDto["options"][number]["style"]): string {
  if (style === "primary") {
    return "bg-accent text-on-accent hover:bg-accent-hover";
  }
  if (style === "destructive") {
    return "border border-danger-line bg-danger-soft text-danger hover:bg-surface-hover";
  }
  return "border border-line bg-surface text-ink hover:bg-surface-hover";
}

/**
 * One ask the captain can act on. Every action carries the card's digest; a
 * 409 means the question changed underneath, so the card swaps to the server's
 * current revision and says so instead of landing the click.
 */
export function AskCard({
  ask,
  events,
  expanded = false,
  onChanged,
}: {
  ask: BoardAskDto;
  events?: BoardAskEventDto[];
  expanded?: boolean;
  onChanged: (ask: BoardAskDto) => void;
}) {
  const [showBody, setShowBody] = useState(expanded);
  const [reply, setReply] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [laterDate, setLaterDate] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>("idle");
  const [notice, setNotice] = useState<string | null>(null);

  const open = ask.status === "open";

  const run = async (kind: Busy, action: () => Promise<{ ask: BoardAskDto }>) => {
    setBusy(kind);
    setNotice(null);
    try {
      const result = await action();
      onChanged(result.ask);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 409 && reason.body.ask) {
        setNotice("This question changed since you loaded it. Here is the current version.");
        onChanged(reason.body.ask as BoardAskDto);
      } else {
        setNotice(reason instanceof Error ? reason.message : "That did not go through");
      }
    } finally {
      setBusy("idle");
    }
  };

  const answerOption = (optionId: string) =>
    run("answering", () => api.answerBoardAsk(ask.id, { digest: ask.digest, optionId }));
  const answerText = () => {
    const text = reply.trim();
    if (!text) return;
    void run("answering", () => api.answerBoardAsk(ask.id, { digest: ask.digest, text }));
  };
  const snooze = () => {
    if (!laterDate) return;
    void run("snoozing", () =>
      api.snoozeBoardAsk(ask.id, { digest: ask.digest, until: laterDate }),
    ).then(() => setLaterDate(null));
  };
  const dismiss = () =>
    run("dismissing", () =>
      api.dismissBoardAsk(ask.id, {
        digest: ask.digest,
        ...(dismissReason?.trim() ? { reason: dismissReason.trim() } : {}),
      }),
    ).then(() => setDismissReason(null));

  const working = busy !== "idle";

  return (
    <article
      aria-labelledby={`ask-${ask.id}-title`}
      className="rounded-2xl border border-line bg-surface p-4 shadow-xs"
      data-ask-id={ask.id}
    >
      <header className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
        <AgentChip agent={ask.agent} display={ask.agentDisplay} />
        <span className={`rounded-full px-2 py-0.5 font-semibold ${priorityClass(ask.priority)}`}>
          {priorityLabel(ask.priority)}
        </span>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-ink-subtle">
          {kindLabel(ask.kind)}
        </span>
        {ask.taskId ? <span className="font-mono">{ask.taskId}</span> : null}
        <time
          className="ml-auto"
          dateTime={ask.createdAt}
          title={new Date(ask.createdAt).toLocaleString()}
        >
          {relativeTime(ask.createdAt)}
        </time>
      </header>

      <h3
        className="mt-2.5 text-base font-semibold leading-snug text-ink"
        id={`ask-${ask.id}-title`}
      >
        {ask.title}
      </h3>

      {ask.body ? (
        <div className="mt-2">
          <p
            className={`whitespace-pre-wrap text-sm leading-6 text-ink-muted ${
              showBody
                ? ""
                : "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]"
            }`}
          >
            {ask.body}
          </p>
          {ask.body.length > 180 ? (
            <button
              className="mt-1 text-xs font-medium text-accent-text"
              onClick={() => setShowBody((value) => !value)}
              type="button"
            >
              {showBody ? "Show less" : "Show more"}
            </button>
          ) : null}
          <p className="mt-1 text-[11px] text-ink-faint">
            Written by {ask.agent}; treat as untrusted.
          </p>
        </div>
      ) : null}

      <div className="mt-2.5">
        <LinkChips links={ask.links} />
      </div>

      {notice ? (
        <p className="mt-3 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger">
          {notice}
        </p>
      ) : null}

      {open ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {ask.kind === "todo" ? (
              <button
                className="min-h-11 flex-1 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition hover:bg-accent-hover disabled:opacity-50"
                disabled={working}
                onClick={() => void answerOption("done")}
                type="button"
              >
                Done
              </button>
            ) : (
              ask.options.map((option) => (
                <button
                  className={`min-h-11 flex-1 basis-[calc(50%-0.25rem)] rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50 ${optionClass(option.style)}`}
                  disabled={working}
                  key={option.id}
                  onClick={() => void answerOption(option.id)}
                  type="button"
                >
                  {option.label}
                </button>
              ))
            )}
          </div>

          {ask.allowText ? (
            showReply ? (
              <div className="flex flex-col gap-2">
                <textarea
                  aria-label="Reply"
                  className="min-h-24 w-full rounded-xl border border-line bg-field px-3 py-2 text-sm text-ink"
                  disabled={working}
                  maxLength={4000}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder={`Reply to ${ask.agent}`}
                  value={reply}
                />
                <div className="flex gap-2">
                  <button
                    className="min-h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-on-accent transition hover:bg-accent-hover disabled:opacity-50"
                    disabled={working || reply.trim().length === 0}
                    onClick={answerText}
                    type="button"
                  >
                    Send reply
                  </button>
                  <button
                    className="min-h-10 rounded-xl px-3 text-sm font-medium text-ink-subtle hover:bg-surface-hover"
                    onClick={() => setShowReply(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="min-h-10 self-start rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink-muted transition hover:bg-surface-hover"
                disabled={working}
                onClick={() => setShowReply(true)}
                type="button"
              >
                Reply…
              </button>
            )
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {ask.allowLater ? (
              laterDate === null ? (
                <button
                  className="min-h-9 rounded-lg px-2.5 font-medium text-ink-subtle hover:bg-surface-hover hover:text-ink"
                  disabled={working}
                  onClick={() => setLaterDate(defaultLaterDate())}
                  type="button"
                >
                  Later
                </button>
              ) : (
                <span className="flex items-center gap-2">
                  <input
                    aria-label="Revisit on"
                    className="min-h-9 rounded-lg border border-line bg-field px-2 text-xs text-ink"
                    onChange={(event) => setLaterDate(event.target.value)}
                    type="date"
                    value={laterDate}
                  />
                  <button
                    className="min-h-9 rounded-lg bg-surface-muted px-2.5 font-medium text-ink"
                    disabled={working || !laterDate}
                    onClick={snooze}
                    type="button"
                  >
                    Snooze
                  </button>
                  <button
                    className="min-h-9 px-2 text-ink-faint"
                    onClick={() => setLaterDate(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                </span>
              )
            ) : null}
            {dismissReason === null ? (
              <button
                className="min-h-9 rounded-lg px-2.5 font-medium text-ink-subtle hover:bg-surface-hover hover:text-danger"
                disabled={working}
                onClick={() => setDismissReason("")}
                type="button"
              >
                Dismiss
              </button>
            ) : (
              <span className="flex flex-1 items-center gap-2">
                <input
                  aria-label="Reason"
                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-field px-2 text-xs text-ink"
                  maxLength={200}
                  onChange={(event) => setDismissReason(event.target.value)}
                  placeholder="Why? (optional)"
                  value={dismissReason}
                />
                <button
                  className="min-h-9 rounded-lg bg-danger-soft px-2.5 font-medium text-danger"
                  disabled={working}
                  onClick={() => void dismiss()}
                  type="button"
                >
                  Dismiss
                </button>
                <button
                  className="min-h-9 px-2 text-ink-faint"
                  onClick={() => setDismissReason(null)}
                  type="button"
                >
                  Cancel
                </button>
              </span>
            )}
            {ask.snoozeUntil ? (
              <span className="ml-auto text-ink-faint">
                Snoozed until {new Date(ask.snoozeUntil).toLocaleDateString()}
              </span>
            ) : null}
            {working ? <span className="ml-auto text-ink-faint">Saving…</span> : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-surface-muted px-3 py-2 text-sm">
          <p className="font-medium text-ink">
            {ask.status === "answered" ? "You answered: " : ""}
            {answerSummary(ask)}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {ask.answer
              ? `${relativeTime(ask.answer.answeredAt)} via ${ask.answer.via.replace("_", " ")} · `
              : ""}
            {deliveryLabel(ask)}
          </p>
        </div>
      )}

      {events && events.length > 0 ? (
        <ol className="mt-4 border-t border-line pt-3 text-[11px] text-ink-faint">
          {events.map((event) => (
            <li className="flex justify-between gap-3 py-0.5" key={event.id}>
              <span>
                {event.kind.replace(/_/g, " ")}
                {event.detail ? ` · ${event.detail}` : ""} · r{event.revision}
              </span>
              <time dateTime={event.occurredAt}>{relativeTime(event.occurredAt)}</time>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}
