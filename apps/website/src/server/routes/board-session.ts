import { createHash } from "node:crypto";
import { boardAnswerSchema, boardDismissSchema, boardSnoozeSchema } from "@hark/contracts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { auth } from "../auth";
import {
  answerAsk,
  askEvents,
  boardPageForUser,
  type CaptainActor,
  dismissAsk,
  ownedAsk,
  snoozeAsk,
  toAskDto,
} from "../lib/board";
import { boardVersion, subscribeBoard } from "../lib/board-stream";
import { isSameOrigin } from "../lib/same-origin";
import { type AuthedEnv, requireAuth } from "../middleware";

/** Domain-separated digest of the Better Auth session id; the raw id is never stored. */
async function sessionActor(request: Request): Promise<CaptainActor> {
  const session = await auth.api.getSession({ headers: request.headers });
  const sessionId = session?.session?.id;
  const sessionHash = sessionId
    ? createHash("sha256").update("hark:board-session:v1\0", "utf8").update(sessionId).digest("hex")
    : null;
  const inWebView = /\bSHark\b/.test(request.headers.get("user-agent") ?? "");
  return { via: inWebView ? "ios_webview" : "web", sessionHash };
}

/**
 * Captain side of the board. Reads need an admitted Apple session; writes also
 * need a same-origin request and the digest of the exact card the captain saw.
 */
export const boardSessionRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .use("*", async (c, next) => {
    if (c.req.method !== "GET" && !isSameOrigin(c.req.raw)) {
      return c.json({ error: "Invalid request origin" }, 403);
    }
    await next();
  })
  .get("/", async (c) => c.json(await boardPageForUser(c.get("user").id)))
  .get("/asks/:id", async (c) => {
    const row = await ownedAsk(c.get("user").id, c.req.param("id"));
    if (!row) return c.json({ error: "Ask not found" }, 404);
    return c.json({ ask: toAskDto(row), events: await askEvents(row.id) });
  })
  .post("/asks/:id/answer", async (c) => {
    const parsed = boardAnswerSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid answer", issues: parsed.error.issues }, 400);
    const outcome = await answerAsk(
      c.get("user").id,
      c.req.param("id"),
      parsed.data,
      await sessionActor(c.req.raw),
    );
    if (!outcome.ok) {
      return c.json(
        { error: outcome.error, ...(outcome.ask ? { ask: toAskDto(outcome.ask) } : {}) },
        outcome.status,
      );
    }
    return c.json({ ask: toAskDto(outcome.row) });
  })
  .post("/asks/:id/snooze", async (c) => {
    const parsed = boardSnoozeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid snooze", issues: parsed.error.issues }, 400);
    const outcome = await snoozeAsk(
      c.get("user").id,
      c.req.param("id"),
      parsed.data,
      await sessionActor(c.req.raw),
    );
    if (!outcome.ok) {
      return c.json(
        { error: outcome.error, ...(outcome.ask ? { ask: toAskDto(outcome.ask) } : {}) },
        outcome.status,
      );
    }
    return c.json({ ask: toAskDto(outcome.row) });
  })
  .post("/asks/:id/dismiss", async (c) => {
    const parsed = boardDismissSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: "Invalid dismiss", issues: parsed.error.issues }, 400);
    const outcome = await dismissAsk(
      c.get("user").id,
      c.req.param("id"),
      parsed.data,
      await sessionActor(c.req.raw),
    );
    if (!outcome.ok) {
      return c.json(
        { error: outcome.error, ...(outcome.ask ? { ask: toAskDto(outcome.ask) } : {}) },
        outcome.status,
      );
    }
    return c.json({ ask: toAskDto(outcome.row) });
  })
  .get("/stream", (c) => {
    const userId = c.get("user").id;
    return streamSSE(c, async (stream) => {
      let version = boardVersion(userId);
      await stream.writeSSE({ event: "changed", data: String(version), id: String(version) });
      let wake: (() => void) | null = null;
      const unsubscribe = subscribeBoard(userId, (next) => {
        version = next;
        wake?.();
      });
      // Proxies drop idle connections; a comment every 25 s keeps this one open.
      const keepalive = setInterval(() => {
        wake?.();
      }, 25_000);
      stream.onAbort(() => {
        clearInterval(keepalive);
        unsubscribe();
        wake?.();
      });
      let sent = version;
      while (!stream.aborted) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
        if (stream.aborted) break;
        if (version !== sent) {
          sent = version;
          await stream.writeSSE({ event: "changed", data: String(version), id: String(version) });
        } else {
          await stream.write(": keepalive\n\n");
        }
      }
      clearInterval(keepalive);
      unsubscribe();
    });
  });
