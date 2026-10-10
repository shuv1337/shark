import type { BoardCrewEntryDto, BoardNoteDto, BoardWorkItemDto } from "@hark/contracts";
import type { ReactNode } from "react";
import { AgentChip, LinkChips } from "./AskCard";
import { relativeTime, workStateLabel } from "./format";

export function Lane({
  id,
  title,
  count,
  children,
  empty,
}: {
  id: string;
  title: string;
  count: number;
  children: ReactNode;
  empty: string;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-10 first:mt-0">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-lg font-semibold text-ink" id={`${id}-heading`}>
          {title}
        </h2>
        <span className="text-xs text-ink-faint">{count}</span>
      </div>
      {count === 0 ? <p className="text-sm text-ink-faint">{empty}</p> : children}
    </section>
  );
}

function stateDot(item: BoardWorkItemDto): string {
  if (item.stale) return "bg-warn";
  switch (item.state) {
    case "in_flight":
    case "review":
      return "bg-info";
    case "blocked":
      return "bg-danger";
    case "queued":
      return "bg-idle";
    case "done":
      return "bg-accent";
    default:
      return "bg-ink-disabled";
  }
}

export function WorkCard({ item }: { item: BoardWorkItemDto }) {
  const terminal = item.state === "done" || item.state === "failed" || item.state === "cancelled";
  return (
    <article
      className="rounded-2xl border border-line bg-surface p-4 shadow-xs"
      data-work-id={item.id}
    >
      <header className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
        <AgentChip agent={item.agent} display={item.agentDisplay} />
        {item.host ? <span className="font-mono">{item.host}</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          <span aria-hidden="true" className={`size-1.5 rounded-full ${stateDot(item)}`} />
          {workStateLabel(item)}
        </span>
      </header>
      <h3 className="mt-2 text-sm font-semibold text-ink">{item.title}</h3>
      {item.detail ? <p className="mt-1 text-sm leading-5 text-ink-muted">{item.detail}</p> : null}
      {item.note ? <p className="mt-1 text-sm leading-5 text-ink-muted">{item.note}</p> : null}
      {item.progress !== null && !terminal ? (
        <div
          aria-label="Progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(item.progress * 100)}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
          />
        </div>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <LinkChips links={item.links} />
        <span className="text-[11px] text-ink-faint">
          {terminal && item.completedAt
            ? `${workStateLabel(item)} ${relativeTime(item.completedAt)}`
            : `${item.stale ? "last heard" : "heard"} ${relativeTime(item.lastHeartbeatAt)}`}
        </span>
      </div>
    </article>
  );
}

export function NoteCard({ note }: { note: BoardNoteDto }) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-4 shadow-xs">
      <header className="flex items-center gap-1.5 text-[11px] text-ink-faint">
        <AgentChip agent={note.agent} display={note.agentDisplay} />
        <time className="ml-auto" dateTime={note.updatedAt}>
          {relativeTime(note.updatedAt)}
        </time>
      </header>
      <p className="mt-2 text-sm font-medium text-ink">{note.text}</p>
      {note.detail ? (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-ink-muted">{note.detail}</p>
      ) : null}
      {note.link ? (
        <a
          className="mt-2 inline-block text-xs font-medium text-accent-text"
          href={note.link}
          rel="noreferrer"
          target="_blank"
        >
          Open link
        </a>
      ) : null}
    </article>
  );
}

export function CrewStrip({ crew }: { crew: BoardCrewEntryDto[] }) {
  if (crew.length === 0) return null;
  return (
    <ul className="flex gap-2 overflow-x-auto pb-1">
      {crew.map((entry) => (
        <li
          className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs"
          key={entry.tokenId}
        >
          <span className="font-medium text-ink">{entry.agent}</span>
          <span className="text-ink-faint">
            {entry.openAsks > 0 ? `${entry.openAsks} asking` : ""}
            {entry.openAsks > 0 && entry.inFlight > 0 ? " · " : ""}
            {entry.inFlight > 0 ? `${entry.inFlight} working` : ""}
            {entry.openAsks === 0 && entry.inFlight === 0 ? "idle" : ""}
          </span>
          <span className="text-ink-faint">
            {entry.lastSeenAt ? `seen ${relativeTime(entry.lastSeenAt)}` : "never seen"}
          </span>
        </li>
      ))}
    </ul>
  );
}
