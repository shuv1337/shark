import {
  boardAskCancelSchema,
  boardAskUpsertSchema,
  boardDoneSchema,
  boardNoteUpsertSchema,
  boardWorkUpsertSchema,
} from "@hark/contracts";
import { Hono } from "hono";
import {
  ackAsk,
  answersForToken,
  askForToken,
  cancelAsk,
  clearNote,
  markDone,
  toAskDto,
  toNoteDto,
  toWorkDto,
  upsertAsk,
  upsertNote,
  upsertWork,
} from "../lib/board";
import { type AgentEnv, requireApiToken, requireScopes } from "../middleware";

/**
 * Agent side of the board. Every read and write is filtered by the caller's
 * own token id; no scope here can answer an ask or read another agent's rows.
 */
export const boardAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .put("/asks", requireScopes("board:write"), async (c) => {
    const parsed = boardAskUpsertSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid ask", issues: parsed.error.issues }, 400);
    const outcome = await upsertAsk(c.get("apiToken"), parsed.data);
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json(
      {
        ask: toAskDto(outcome.row),
        created: outcome.created,
        changed: outcome.changed,
        pushed: outcome.pushed,
      },
      outcome.created ? 201 : 200,
    );
  })
  .post("/asks/:key/cancel", requireScopes("board:write"), async (c) => {
    const parsed = boardAskCancelSchema.safeParse((await c.req.json().catch(() => ({}))) ?? {});
    if (!parsed.success)
      return c.json({ error: "Invalid cancel", issues: parsed.error.issues }, 400);
    const outcome = await cancelAsk(c.get("apiToken"), c.req.param("key"), parsed.data.reason);
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json({ ask: toAskDto(outcome.row) });
  })
  .post("/asks/:key/ack", requireScopes("board:write"), async (c) => {
    const outcome = await ackAsk(c.get("apiToken"), c.req.param("key"));
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json({ ask: toAskDto(outcome.row) });
  })
  .get("/asks/:key", requireScopes("board:read"), async (c) => {
    const row = await askForToken(c.get("apiToken"), c.req.param("key"));
    if (!row) return c.json({ error: "Ask not found" }, 404);
    return c.json({ ask: toAskDto(row) });
  })
  .get("/asks/:key/wait", requireScopes("board:read"), async (c) => {
    const requested = Number.parseFloat(c.req.query("timeout") ?? "20");
    const timeoutMs = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 0), 25) * 1000;
    const deadline = Date.now() + timeoutMs;
    const signal = c.req.raw.signal;
    while (true) {
      if (signal.aborted) return new Response(null, { status: 499 });
      const row = await askForToken(c.get("apiToken"), c.req.param("key"));
      if (!row) return c.json({ error: "Ask not found" }, 404);
      if (row.status !== "open" || Date.now() >= deadline) {
        return c.json({ ask: toAskDto(row), timedOut: row.status === "open" });
      }
      const delay = Math.min(500, deadline - Date.now());
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timeout);
          resolve();
        };
        const timeout = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delay);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  })
  .get("/answers", requireScopes("board:read"), async (c) => {
    const since = c.req.query("since") || undefined;
    const requested = Number.parseInt(c.req.query("limit") ?? "100", 10);
    const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 100, 1), 100);
    return c.json(await answersForToken(c.get("apiToken"), since, limit));
  })
  .put("/work", requireScopes("board:write"), async (c) => {
    const parsed = boardWorkUpsertSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid work item", issues: parsed.error.issues }, 400);
    const outcome = await upsertWork(c.get("apiToken"), parsed.data);
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json(
      { work: toWorkDto(outcome.row), created: outcome.created },
      outcome.created ? 201 : 200,
    );
  })
  .post("/work/:key/done", requireScopes("board:write"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) ?? {};
    const parsed = boardDoneSchema.safeParse({ ...body, key: c.req.param("key") });
    if (!parsed.success)
      return c.json({ error: "Invalid completion", issues: parsed.error.issues }, 400);
    const outcome = await markDone(c.get("apiToken"), parsed.data);
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json({ work: toWorkDto(outcome.row) });
  })
  .put("/notes", requireScopes("board:write"), async (c) => {
    const parsed = boardNoteUpsertSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid note", issues: parsed.error.issues }, 400);
    const outcome = await upsertNote(c.get("apiToken"), parsed.data);
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json(
      { note: toNoteDto(outcome.row), created: outcome.created },
      outcome.created ? 201 : 200,
    );
  })
  .delete("/notes/:key", requireScopes("board:write"), async (c) => {
    const removed = await clearNote(c.get("apiToken"), c.req.param("key"));
    if (!removed) return c.json({ error: "Note not found" }, 404);
    return c.json({ ok: true });
  });
