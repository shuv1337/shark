import {
  type OncallShiftDto,
  oncallGroupUpdateSchema,
  oncallOverrideCreateSchema,
  oncallPageCreateSchema,
  oncallPageResolveSchema,
} from "@hark/contracts";
import { and, asc, eq, gt } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { oncallGroup, oncallOverride, oncallPage, team, teamMember } from "../db/schema";
import { getBilling } from "../lib/billing";
import { newId } from "../lib/id";
import {
  acknowledgePage,
  checkRotation,
  claimPageResponseToken,
  escalatePage,
  memberGroup,
  memberPage,
  openPagesFor,
  overrideWindows,
  pageRecipientByToken,
  people,
  type RaisePageInput,
  raisePage,
  releasePageResponseToken,
  resolvePage,
  rotationOf,
  toGroupDto,
  toPageDto,
} from "../lib/oncall";
import { onCallThroughout, upcomingShifts } from "../lib/oncall-schedule";
import { agentAdmission } from "../lib/rate-windows";
import { hasRole, sendNotice } from "../lib/teams";
import {
  type AgentEnv,
  type AuthedEnv,
  requireApiToken,
  requireAuth,
  requireScopes,
} from "../middleware";
import { agentRateLimit } from "./activities";
import { type Actor, type Outcome, readJson, send, withAgent } from "./teams";

const result = (body: unknown, status: 200 | 201 = 200): Outcome => ({ status, body });
const failure = (status: Outcome["status"], error: string, extra: object = {}): Outcome => ({
  status,
  body: { error, ...extra },
});

const GROUP_NOT_FOUND = failure(404, "On-call group not found");
const PAGE_NOT_FOUND = failure(404, "Page not found");
const FORBIDDEN_ADMIN = failure(403, "Only team owners and admins can change on-call groups");
const FORBIDDEN_HANDOFF = failure(
  403,
  "Members can only hand off time they are on call for; ask a team owner or admin to schedule other time",
);
const PARTLY_SHADOWED = failure(
  409,
  "That window is partly covered by a later-starting override; split the override around it",
);
const MAX_OVERRIDE_MS = 90 * 86_400_000;

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function getGroup(actor: Actor, groupId: string): Promise<Outcome> {
  const found = await memberGroup(groupId, actor.id);
  if (!found) return GROUP_NOT_FOUND;
  return result({ group: await toGroupDto(found.group) });
}

async function updateGroup(actor: Actor, groupId: string, input: unknown): Promise<Outcome> {
  const found = await memberGroup(groupId, actor.id);
  if (!found) return GROUP_NOT_FOUND;
  if (!hasRole(found.role as "member", "admin")) return FORBIDDEN_ADMIN;
  const parsed = oncallGroupUpdateSchema.safeParse(input);
  if (!parsed.success)
    return failure(400, "Invalid on-call group", { issues: parsed.error.issues });
  let rotationValues = {};
  if (parsed.data.rotation) {
    const rotation = await checkRotation(found.group.teamId, parsed.data.rotation);
    if (!rotation.ok) return failure(400, rotation.error);
    rotationValues = rotation.values;
  }
  const [updated] = await db
    .update(oncallGroup)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...rotationValues,
      ...(parsed.data.escalation !== undefined ? { escalation: parsed.data.escalation } : {}),
      updatedAt: new Date(),
    })
    .where(eq(oncallGroup.id, groupId))
    .returning();
  if (!updated) return GROUP_NOT_FOUND;
  return result({ group: await toGroupDto(updated) });
}

async function deleteGroup(actor: Actor, groupId: string): Promise<Outcome> {
  const found = await memberGroup(groupId, actor.id);
  if (!found) return GROUP_NOT_FOUND;
  if (!hasRole(found.role as "member", "admin")) return FORBIDDEN_ADMIN;
  await db.delete(oncallGroup).where(eq(oncallGroup.id, groupId));
  return result({ ok: true });
}

/**
 * Team owners and admins schedule anyone for any window. A member can only
 * hand off time they are already on call for (by the rotation or an earlier
 * override) to any team member, so a member never displaces someone else; a
 * member's handoff starts no earlier than now, since past time is not theirs
 * to give away. Either way, 201 means the override is in force for all of its
 * remaining window: one that a later-starting override would partly shadow
 * is refused rather than stored half-effective.
 */
async function createOverride(actor: Actor, groupId: string, input: unknown): Promise<Outcome> {
  const parsed = oncallOverrideCreateSchema.safeParse(input);
  if (!parsed.success) {
    return (await memberGroup(groupId, actor.id))
      ? failure(400, "Invalid override", { issues: parsed.error.issues })
      : GROUP_NOT_FOUND;
  }
  const requestedStart = Date.parse(parsed.data.startsAt);
  const endsAt = Date.parse(parsed.data.endsAt);
  const now = Date.now();
  // Synchronous, so the membership, role, rotation, and overrides it decides
  // on are the ones current when the row is written, and two concurrent
  // handoffs cannot both give away the same time.
  const outcome = db.transaction((tx) => {
    const found = tx
      .select({ group: oncallGroup, role: teamMember.role })
      .from(oncallGroup)
      .innerJoin(
        teamMember,
        and(eq(teamMember.teamId, oncallGroup.teamId), eq(teamMember.userId, actor.id)),
      )
      .where(eq(oncallGroup.id, groupId))
      .get();
    if (!found) return { ok: false as const, error: GROUP_NOT_FOUND };
    const target = tx
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(
        and(eq(teamMember.teamId, found.group.teamId), eq(teamMember.userId, parsed.data.userId)),
      )
      .get();
    if (!target)
      return { ok: false as const, error: failure(400, "The override must name a team member") };
    if (endsAt <= requestedStart)
      return { ok: false as const, error: failure(400, "endsAt must be after startsAt") };
    if (endsAt <= now)
      return { ok: false as const, error: failure(400, "endsAt must be in the future") };
    if (endsAt - requestedStart > MAX_OVERRIDE_MS) {
      return { ok: false as const, error: failure(400, "Overrides last at most 90 days") };
    }
    const admin = hasRole(found.role as "member", "admin");
    const startsAt = admin ? requestedStart : Math.max(requestedStart, now);
    // Only the part still to come decides who is paged.
    const from = Math.max(startsAt, now);
    const rotation = rotationOf(found.group);
    const existing = overrideWindows(
      tx
        .select()
        .from(oncallOverride)
        .where(and(eq(oncallOverride.groupId, groupId), gt(oncallOverride.endsAt, new Date(now))))
        .all(),
    );
    if (!admin && !onCallThroughout(rotation, existing, actor.id, from, endsAt)) {
      return { ok: false as const, error: FORBIDDEN_HANDOFF };
    }
    // Strictly newer than every live override, so among overrides starting
    // together this one outranks them by `createdAt`, never by a random id.
    const createdAt = Math.max(now, ...existing.map((window) => (window.createdAt ?? 0) + 1));
    const row = {
      id: newId("ovr"),
      groupId,
      userId: parsed.data.userId,
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      createdByUserId: actor.id,
      createdAt: new Date(createdAt),
    };
    const [candidate] = overrideWindows([row]);
    if (
      !candidate ||
      !onCallThroughout(rotation, [...existing, candidate], row.userId, from, endsAt)
    ) {
      return { ok: false as const, error: PARTLY_SHADOWED };
    }
    tx.insert(oncallOverride).values(row).run();
    return { ok: true as const, group: found.group, row };
  });
  if (!outcome.ok) return outcome.error;
  if (outcome.row.userId !== actor.id) {
    void notifyOverrideRecipient(actor, outcome.group, outcome.row).catch((error: unknown) =>
      console.error("[oncall] Override notice failed", error),
    );
  }
  return result({ group: await toGroupDto(outcome.group) }, 201);
}

function formatOverrideTime(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

/** Tells the person an override names that someone else put them on call. */
async function notifyOverrideRecipient(
  actor: Actor,
  group: typeof oncallGroup.$inferSelect,
  row: { userId: string; startsAt: Date; endsAt: Date },
): Promise<void> {
  const from = formatOverrideTime(row.startsAt, group.timezone);
  const until = formatOverrideTime(row.endsAt, group.timezone);
  await sendNotice([row.userId], {
    senderUserId: actor.id,
    title: `${actor.name} put you on call for ${group.name}`,
    body: `You're on call from ${from} until ${until}.`,
    sourceName: group.name,
    url: "shark://oncall",
    conversationKey: `oncall-${group.id}`,
  });
}

async function deleteOverride(actor: Actor, groupId: string, overrideId: string): Promise<Outcome> {
  const found = await memberGroup(groupId, actor.id);
  if (!found) return GROUP_NOT_FOUND;
  const [row] = await db
    .select()
    .from(oncallOverride)
    .where(and(eq(oncallOverride.id, overrideId), eq(oncallOverride.groupId, groupId)))
    .limit(1);
  if (!row) return failure(404, "Override not found");
  if (
    row.userId !== actor.id &&
    row.createdByUserId !== actor.id &&
    !hasRole(found.role as "member", "admin")
  ) {
    return failure(
      403,
      "Only team owners and admins can remove an override that neither names you nor was created by you",
    );
  }
  await db.delete(oncallOverride).where(eq(oncallOverride.id, row.id));
  return result({ group: await toGroupDto(found.group) });
}

async function createPage(
  actor: Actor,
  groupId: string,
  input: unknown,
  sourceName: string,
  origin?: RaisePageInput["origin"],
  admit?: RaisePageInput["admit"],
): Promise<Outcome> {
  const found = await memberGroup(groupId, actor.id);
  if (!found) return GROUP_NOT_FOUND;
  const parsed = oncallPageCreateSchema.safeParse(input);
  if (!parsed.success) return failure(400, "Invalid page", { issues: parsed.error.issues });
  const outcome = await raisePage({
    group: found.group,
    input: parsed.data,
    creatorUserId: actor.id,
    sourceName,
    origin,
    admit,
  });
  return outcome.ok ? result(outcome.body, outcome.status) : failure(outcome.status, outcome.error);
}

async function getPage(actor: Actor, pageId: string): Promise<Outcome> {
  const page = await memberPage(pageId, actor.id);
  if (!page) return PAGE_NOT_FOUND;
  return result({ page: await toPageDto(page) });
}

async function resolve(actor: Actor, pageId: string, input: unknown): Promise<Outcome> {
  const page = await memberPage(pageId, actor.id);
  if (!page) return PAGE_NOT_FOUND;
  const parsed = oncallPageResolveSchema.safeParse(input ?? {});
  if (!parsed.success)
    return failure(400, "Invalid resolve request", { issues: parsed.error.issues });
  const outcome = await resolvePage(page, actor.id, parsed.data.note);
  if (!outcome.ok) return failure(409, outcome.error, { page: await toPageDto(outcome.page) });
  return result({ page: await toPageDto(outcome.page) });
}

async function myOncall(actor: Actor): Promise<Outcome> {
  const groups = await db
    .select({ group: oncallGroup, teamName: team.name })
    .from(oncallGroup)
    .innerJoin(team, eq(team.id, oncallGroup.teamId))
    .innerJoin(
      teamMember,
      and(eq(teamMember.teamId, oncallGroup.teamId), eq(teamMember.userId, actor.id)),
    )
    .orderBy(asc(oncallGroup.name));
  const now = Date.now();
  const [me] = [...(await people([actor.id])).values()];
  const shifts: Array<
    OncallShiftDto & { groupId: string; groupName: string; teamId: string; teamName: string }
  > = [];
  for (const { group, teamName } of groups) {
    const overrides = await db
      .select()
      .from(oncallOverride)
      .where(eq(oncallOverride.groupId, group.id));
    const windows = overrideWindows(overrides.filter((row) => row.endsAt.getTime() > now));
    for (const shift of upcomingShifts(rotationOf(group), windows, now, 10)) {
      if (shift.userId !== actor.id) continue;
      shifts.push({
        person: me ?? { userId: actor.id, name: actor.name, image: null },
        startsAt: new Date(shift.startsAt).toISOString(),
        endsAt: new Date(shift.endsAt).toISOString(),
        override: shift.override,
        ...(shift.overrideId ? { overrideId: shift.overrideId } : {}),
        groupId: group.id,
        groupName: group.name,
        teamId: group.teamId,
        teamName,
      });
    }
  }
  shifts.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return result({ shifts, pages: await openPagesFor(actor.id) });
}

// ---------------------------------------------------------------------------
// Session routes
// ---------------------------------------------------------------------------

function sessionActor(c: { get(key: "user"): { id: string; name: string; email: string } }): Actor {
  const user = c.get("user");
  return { id: user.id, name: user.name, email: user.email };
}

export const oncallSessionRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/me", async (c) => send(c, await myOncall(sessionActor(c))))
  .get("/:groupId", async (c) => send(c, await getGroup(sessionActor(c), c.req.param("groupId"))))
  .patch("/:groupId", async (c) =>
    send(c, await updateGroup(sessionActor(c), c.req.param("groupId"), await readJson(c))),
  )
  .delete("/:groupId", async (c) =>
    send(c, await deleteGroup(sessionActor(c), c.req.param("groupId"))),
  )
  .post("/:groupId/overrides", async (c) =>
    send(c, await createOverride(sessionActor(c), c.req.param("groupId"), await readJson(c))),
  )
  .delete("/:groupId/overrides/:overrideId", async (c) =>
    send(
      c,
      await deleteOverride(sessionActor(c), c.req.param("groupId"), c.req.param("overrideId")),
    ),
  )
  .post("/:groupId/pages", async (c) => {
    const actor = sessionActor(c);
    return send(c, await createPage(actor, c.req.param("groupId"), await readJson(c), actor.name));
  });

export const pagesSessionRoute = new Hono<AuthedEnv>()
  .use("*", requireAuth)
  .get("/:id", async (c) => send(c, await getPage(sessionActor(c), c.req.param("id"))))
  .post("/:id/acknowledge", async (c) => {
    const actor = sessionActor(c);
    const page = await memberPage(c.req.param("id"), actor.id);
    if (!page) return send(c, PAGE_NOT_FOUND);
    const outcome = await acknowledgePage(page, actor.id);
    if (!outcome.ok) {
      return c.json({ error: outcome.error, page: await toPageDto(outcome.page) }, 409);
    }
    return c.json({ page: await toPageDto(outcome.page) });
  })
  .post("/:id/escalate", async (c) => {
    const actor = sessionActor(c);
    const page = await memberPage(c.req.param("id"), actor.id);
    if (!page) return send(c, PAGE_NOT_FOUND);
    const outcome = await escalatePage(page.id, true);
    if (!outcome.ok) {
      return c.json(
        {
          error: outcome.error,
          ...(outcome.page ? { page: await toPageDto(outcome.page) } : {}),
        },
        outcome.status,
      );
    }
    return c.json({ page: await toPageDto(outcome.page) });
  })
  .post("/:id/resolve", async (c) =>
    send(c, await resolve(sessionActor(c), c.req.param("id"), await readJson(c))),
  );

const pageCredentialSchema = z.object({
  responseToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
});

/**
 * Lock-screen actions authenticated by the page's one-shot credential, like
 * interaction responses. The credential identifies the recipient, so the
 * acknowledgement is still a specific person's decision.
 */
export const pageResponsesRoute = new Hono()
  .post("/:id/acknowledge", async (c) => {
    const parsed = pageCredentialSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "Invalid page response" }, 400);
    const found = await pageRecipientByToken(c.req.param("id"), parsed.data.responseToken);
    if (!found) return c.json({ error: "Page not found" }, 404);
    if (found.usedAt || !(await claimPageResponseToken(found.page.id, found.userId))) {
      return spentCredential(c, found.page);
    }
    const outcome = await acknowledgePage(found.page, found.userId);
    if (!outcome.ok) {
      await releasePageResponseToken(found.page.id, found.userId);
      return c.json({ error: outcome.error, status: outcome.page.status }, 409);
    }
    return c.json({ ok: true, status: outcome.page.status });
  })
  .post("/:id/escalate", async (c) => {
    const parsed = pageCredentialSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "Invalid page response" }, 400);
    const found = await pageRecipientByToken(c.req.param("id"), parsed.data.responseToken);
    if (!found) return c.json({ error: "Page not found" }, 404);
    if (found.usedAt || !(await claimPageResponseToken(found.page.id, found.userId))) {
      return spentCredential(c, found.page);
    }
    const outcome = await escalatePage(found.page.id, true);
    if (!outcome.ok) {
      await releasePageResponseToken(found.page.id, found.userId);
      return c.json(
        { error: outcome.error, status: outcome.page?.status ?? found.page.status },
        outcome.status,
      );
    }
    return c.json({ ok: true, status: outcome.page.status });
  });

/**
 * A lock-screen credential is spent by its first successful action. Reusing
 * it answers 409 with the page's current status, like acting on a page that
 * is no longer triggered, and never acts again.
 */
async function spentCredential(c: Context, page: { id: string; status: string }) {
  const [latest] = await db
    .select({ status: oncallPage.status })
    .from(oncallPage)
    .where(eq(oncallPage.id, page.id))
    .limit(1);
  const status = latest?.status ?? page.status;
  return c.json(
    {
      error:
        status === "triggered"
          ? "This page response was already used"
          : `Page is already ${status}`,
      status,
    },
    409,
  );
}

// ---------------------------------------------------------------------------
// Agent routes
// ---------------------------------------------------------------------------

/**
 * Agent-token twin mounted at `/api/agent/oncall`. Agents can raise and
 * resolve pages, but acknowledging and escalating are human decisions: an
 * acknowledgement tells the team a person is on it.
 */
export const oncallAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/me", requireScopes("oncall:read"), async (c) => withAgent(c, (actor) => myOncall(actor)))
  .get("/:groupId", requireScopes("oncall:read"), async (c) =>
    withAgent(c, (actor) => getGroup(actor, c.req.param("groupId"))),
  )
  .patch("/:groupId", requireScopes("oncall:write"), async (c) =>
    withAgent(c, async (actor) => updateGroup(actor, c.req.param("groupId"), await readJson(c))),
  )
  .delete("/:groupId", requireScopes("oncall:write"), async (c) =>
    withAgent(c, (actor) => deleteGroup(actor, c.req.param("groupId"))),
  )
  .post("/:groupId/overrides", requireScopes("oncall:write"), async (c) =>
    withAgent(c, async (actor) => createOverride(actor, c.req.param("groupId"), await readJson(c))),
  )
  .delete("/:groupId/overrides/:overrideId", requireScopes("oncall:write"), async (c) =>
    withAgent(c, (actor) =>
      deleteOverride(actor, c.req.param("groupId"), c.req.param("overrideId")),
    ),
  )
  .post("/:groupId/pages", requireScopes("oncall:write"), async (c) =>
    withAgent(c, async (actor) => {
      const token = c.get("apiToken");
      const { limits } = await getBilling(actor, true);
      const limited = agentRateLimit(token, limits);
      if (limited) {
        c.header("Retry-After", "60");
        return { status: 429, body: limited };
      }
      const outcome = await createPage(
        actor,
        c.req.param("groupId"),
        await readJson(c),
        token.name,
        { requesterTokenId: token.id },
        agentAdmission(token, limits),
      );
      if (outcome.status !== 429) return outcome;
      c.header("Retry-After", "60");
      return { status: 429, body: { ...(outcome.body as object), retryAfterSeconds: 60 } };
    }),
  );

export const pagesAgentRoute = new Hono<AgentEnv>()
  .use("*", requireApiToken)
  .get("/:id", requireScopes("oncall:read"), async (c) =>
    withAgent(c, (actor) => getPage(actor, c.req.param("id"))),
  )
  .post("/:id/resolve", requireScopes("oncall:write"), async (c) =>
    withAgent(c, async (actor) => resolve(actor, c.req.param("id"), await readJson(c))),
  );

/** Raises a page for a webhook or agent notification carrying `oncall`. */
export async function raisePageFor(
  userId: string,
  groupId: string,
  input: unknown,
  sourceName: string,
  origin: RaisePageInput["origin"],
  admit?: RaisePageInput["admit"],
) {
  const found = await memberGroup(groupId, userId);
  if (!found) return { ok: false as const, status: 404 as const, error: "On-call group not found" };
  const parsed = oncallPageCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400 as const,
      error: "Invalid page",
      issues: parsed.error.issues,
    };
  }
  return raisePage({
    group: found.group,
    input: parsed.data,
    creatorUserId: userId,
    sourceName,
    origin,
    admit,
  });
}
