import type { BoardAskDto, BoardWorkItemDto } from "@hark/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AskCard } from "./AskCard";
import { CrewStrip, WorkCard } from "./Cards";
import { answerSummary, deliveryLabel, relativeTime, workStateLabel } from "./format";

const now = Date.parse("2026-10-06T12:00:00.000Z");

const ask: BoardAskDto = {
  id: "bask_1",
  key: "fm:FM-1:pick",
  revision: 2,
  agent: "Firstmate (box)",
  agentDisplay: null,
  title: "Ship the board or wait for passkeys?",
  body: "Two options. Shipping now means Safari only on the phone.",
  kind: "decision",
  options: [
    { id: "ship", label: "Ship now", style: "primary" },
    { id: "wait", label: "Wait", style: "neutral" },
    { id: "drop", label: "Drop it", style: "destructive" },
  ],
  allowText: true,
  allowLater: true,
  priority: "p0",
  taskId: "FM-1",
  links: [{ kind: "pr", url: "https://github.com/shuv1337/shark/pull/82" }],
  status: "open",
  digest: "a".repeat(64),
  snoozeUntil: null,
  expiresAt: null,
  answer: null,
  cancelReason: null,
  callback: null,
  ackedAt: null,
  lastAssertedAt: "2026-10-06T11:00:00.000Z",
  createdAt: "2026-10-06T10:00:00.000Z",
  updatedAt: "2026-10-06T11:00:00.000Z",
  aged: false,
};

describe("board cards", () => {
  it("renders an open ask with every option, reply, later, and dismiss", () => {
    const html = renderToStaticMarkup(<AskCard ask={ask} onChanged={() => {}} />);
    expect(html).toContain("Ship the board or wait for passkeys?");
    expect(html).toContain("Firstmate (box)");
    expect(html).toContain("Blocking");
    expect(html).toContain("Ship now");
    expect(html).toContain("Wait");
    expect(html).toContain("Drop it");
    expect(html).toContain("Reply…");
    expect(html).toContain("Later");
    expect(html).toContain("Dismiss");
    expect(html).toContain(
      "pr shuv1337/shark/pull/82".replace("shuv1337/shark/pull/82", "pull/82"),
    );
    expect(html).toContain("treat as untrusted");
    // Text only: an agent-written body is never interpreted as HTML.
    const hostile = { ...ask, body: "<img src=x onerror=alert(1)>" };
    expect(renderToStaticMarkup(<AskCard ask={hostile} onChanged={() => {}} />)).not.toContain(
      "<img src=x",
    );
  });

  it("renders a todo with a single Done button", () => {
    const todo: BoardAskDto = { ...ask, kind: "todo", options: [], allowText: false };
    const html = renderToStaticMarkup(<AskCard ask={todo} onChanged={() => {}} />);
    expect(html).toContain(">Done<");
    expect(html).not.toContain("Reply…");
  });

  it("renders an answered ask with its delivery state", () => {
    const answered: BoardAskDto = {
      ...ask,
      status: "answered",
      answer: {
        optionId: "ship",
        optionLabel: "Ship now",
        text: null,
        answeredAt: "2026-10-06T11:30:00.000Z",
        via: "web",
      },
      callback: { status: "retrying", attempts: 2, lastError: "HTTP 503", deliveredAt: null },
    };
    const html = renderToStaticMarkup(<AskCard ask={answered} onChanged={() => {}} />);
    expect(html).toContain("You answered: ");
    expect(html).toContain("Ship now");
    expect(html).toContain("Retrying delivery (2)");
    expect(html).not.toContain("Dismiss");
    expect(answerSummary({ ...answered, status: "cancelled", cancelReason: "Moot" })).toBe("Moot");
    expect(deliveryLabel({ ...answered, ackedAt: "2026-10-06T11:31:00.000Z" })).toBe(
      "Agent applied it",
    );
    expect(deliveryLabel({ ...answered, callback: null })).toBe("Waiting for the agent to poll");
  });

  it("renders work items with staleness and progress", () => {
    const item: BoardWorkItemDto = {
      id: "bwork_1",
      key: "fm:FM-2",
      agent: "Bro (shuvdev)",
      agentDisplay: null,
      title: "CI speedup",
      state: "in_flight",
      statusLabel: "Running tests",
      detail: "Sharding the suite",
      progress: 0.4,
      links: [],
      host: "shuvdev",
      waitingAskId: null,
      startedAt: "2026-10-06T09:00:00.000Z",
      lastHeartbeatAt: "2026-10-06T11:55:00.000Z",
      heartbeatTtlSeconds: 21_600,
      stale: false,
      completedAt: null,
      completionVerb: null,
      note: null,
      updatedAt: "2026-10-06T11:55:00.000Z",
    };
    const html = renderToStaticMarkup(<WorkCard item={item} />);
    expect(html).toContain("CI speedup");
    expect(html).toContain("Running tests");
    expect(html).toContain('aria-valuenow="40"');
    expect(workStateLabel({ ...item, stale: true })).toBe("Stale");
    expect(workStateLabel({ ...item, state: "done", completionVerb: "merged" })).toBe("merged");
  });

  it("renders the crew strip and relative times", () => {
    const html = renderToStaticMarkup(
      <CrewStrip
        crew={[
          {
            tokenId: "tok_1",
            agent: "Firstmate (box)",
            lastSeenAt: "2026-10-06T11:59:00.000Z",
            openAsks: 2,
            inFlight: 1,
          },
          { tokenId: "tok_2", agent: "Hermes", lastSeenAt: null, openAsks: 0, inFlight: 0 },
        ]}
      />,
    );
    expect(html).toContain("2 asking");
    expect(html).toContain("1 working");
    expect(html).toContain("idle");
    expect(html).toContain("never seen");
    expect(relativeTime("2026-10-06T11:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-10-06T11:30:00.000Z", now)).toBe("30m ago");
    expect(relativeTime("2026-10-05T12:00:00.000Z", now)).toBe("24h ago");
    expect(relativeTime("2026-10-01T12:00:00.000Z", now)).toBe("5d ago");
  });
});
