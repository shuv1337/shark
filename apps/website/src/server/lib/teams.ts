import type { TeamDto, TeamInviteDto, TeamMemberDto, TeamRole } from "@hark/contracts";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  agentNotification,
  app,
  appMemberState,
  device,
  oncallGroup,
  oncallOverride,
  team,
  type teamInvite,
  teamMember,
  user as userTable,
} from "../db/schema";
import { newId } from "./id";
import { buildPushMessages, sendPushMessages } from "./push";
import { teamSeats } from "./team-billing";

export type TeamRow = typeof team.$inferSelect;
export type InviteRow = typeof teamInvite.$inferSelect;

const ROLE_RANK: Record<TeamRole, number> = { member: 1, admin: 2, owner: 3 };

export function hasRole(role: TeamRole, minimum: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export interface Membership {
  team: TeamRow;
  role: TeamRole;
}

/** The team and the user's role in it, or undefined when they are not a member. */
export async function membership(teamId: string, userId: string): Promise<Membership | undefined> {
  const [row] = await db
    .select({ team, role: teamMember.role })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
    .limit(1);
  return row ? { team: row.team, role: row.role as TeamRole } : undefined;
}

export async function memberCount(teamId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamId));
  return row?.value ?? 0;
}

export async function memberIds(teamId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: teamMember.userId })
    .from(teamMember)
    .where(eq(teamMember.teamId, teamId));
  return rows.map((row) => row.userId);
}

/** The team as `lib/team-billing` sees it, with the owner's email as its contact. */
export async function billingCustomer(teamRow: TeamRow) {
  const [owner] = await db
    .select({ email: userTable.email })
    .from(teamMember)
    .innerJoin(userTable, eq(userTable.id, teamMember.userId))
    .where(and(eq(teamMember.teamId, teamRow.id), eq(teamMember.role, "owner")))
    .limit(1);
  return { id: teamRow.id, name: teamRow.name, ...(owner ? { email: owner.email } : {}) };
}

export async function toTeamDto(teamRow: TeamRow, role: TeamRole): Promise<TeamDto> {
  const [[members], [apps], [groups]] = await Promise.all([
    db.select({ value: count() }).from(teamMember).where(eq(teamMember.teamId, teamRow.id)),
    db.select({ value: count() }).from(app).where(eq(app.teamId, teamRow.id)),
    db.select({ value: count() }).from(oncallGroup).where(eq(oncallGroup.teamId, teamRow.id)),
  ]);
  const used = members?.value ?? 0;
  const billing = await teamSeats(await billingCustomer(teamRow), used);
  return {
    id: teamRow.id,
    name: teamRow.name,
    role,
    memberCount: used,
    appCount: apps?.value ?? 0,
    oncallGroupCount: groups?.value ?? 0,
    ...billing,
    createdAt: teamRow.createdAt.toISOString(),
  };
}

export async function listTeams(userId: string): Promise<TeamDto[]> {
  const rows = await db
    .select({ team, role: teamMember.role })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(eq(teamMember.userId, userId))
    .orderBy(asc(team.name), asc(team.id));
  return Promise.all(rows.map((row) => toTeamDto(row.team, row.role as TeamRole)));
}

export async function listMembers(teamId: string): Promise<TeamMemberDto[]> {
  const rows = await db
    .select({ member: teamMember, user: userTable })
    .from(teamMember)
    .innerJoin(userTable, eq(userTable.id, teamMember.userId))
    .where(eq(teamMember.teamId, teamId))
    .orderBy(asc(teamMember.joinedAt), asc(userTable.name));
  const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
  return rows
    .map(
      ({ member, user }): TeamMemberDto => ({
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: member.role as TeamRole,
        joinedAt: member.joinedAt.toISOString(),
      }),
    )
    .sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
}

export async function memberDto(
  teamId: string,
  userId: string,
): Promise<TeamMemberDto | undefined> {
  return (await listMembers(teamId)).find((member) => member.userId === userId);
}

export function toInviteDto(row: InviteRow): TeamInviteDto {
  return {
    id: row.id,
    teamId: row.teamId,
    email: row.email,
    role: row.role as TeamRole,
    invitedBy: row.invitedByName,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Moves a team app back to the member who added it, keeping their own sign-in state. Re-reads the
 * app, so a caller holding a row from before a concurrent return cannot write stale state back.
 */
export function returnAppToAdder(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  loaded: typeof app.$inferSelect,
) {
  const row = tx.select().from(app).where(eq(app.id, loaded.id)).get();
  if (!row || row.teamId === null) return;
  const state = tx
    .select()
    .from(appMemberState)
    .where(and(eq(appMemberState.appId, row.id), eq(appMemberState.userId, row.userId)))
    .get();
  tx.update(app)
    .set({
      teamId: null,
      shareName: state?.shareName ?? row.shareName,
      shareEmail: state?.shareEmail ?? row.shareEmail,
      consentedAt: state ? state.consentedAt : row.consentedAt,
      lastOpenedAt: state ? state.lastOpenedAt : row.lastOpenedAt,
      updatedAt: new Date(),
    })
    .where(eq(app.id, row.id))
    .run();
  tx.delete(appMemberState).where(eq(appMemberState.appId, row.id)).run();
}

/**
 * Removes a member and everything that only made sense while they belonged:
 * the apps they added (which go back to them, as when a team is deleted),
 * their sign-in state for the team's other apps (so no further pass is
 * issued), their place in on-call rotations, and their overrides.
 */
export function removeMember(teamId: string, userId: string): boolean {
  return db.transaction((tx) => {
    const removed = tx
      .delete(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)))
      .returning({ userId: teamMember.userId })
      .all();
    if (removed.length === 0) return false;
    const added = tx
      .select()
      .from(app)
      .where(and(eq(app.teamId, teamId), eq(app.userId, userId)))
      .all();
    for (const row of added) returnAppToAdder(tx, row);
    const teamApps = tx.select({ id: app.id }).from(app).where(eq(app.teamId, teamId));
    tx.delete(appMemberState)
      .where(and(eq(appMemberState.userId, userId), inArray(appMemberState.appId, teamApps)))
      .run();
    const groups = tx.select().from(oncallGroup).where(eq(oncallGroup.teamId, teamId)).all();
    const now = new Date();
    for (const group of groups) {
      if (group.memberIds.includes(userId)) {
        tx.update(oncallGroup)
          .set({ memberIds: group.memberIds.filter((id) => id !== userId), updatedAt: now })
          .where(eq(oncallGroup.id, group.id))
          .run();
      }
    }
    if (groups.length > 0) {
      tx.delete(oncallOverride)
        .where(
          and(
            eq(oncallOverride.userId, userId),
            inArray(
              oncallOverride.groupId,
              groups.map((group) => group.id),
            ),
          ),
        )
        .run();
    }
    return true;
  });
}

/** Deletes a team; its apps go back to the members who added them. */
export function deleteTeam(teamId: string): boolean {
  return db.transaction((tx) => {
    for (const row of tx.select().from(app).where(eq(app.teamId, teamId)).all()) {
      returnAppToAdder(tx, row);
    }
    const deleted = tx.delete(team).where(eq(team.id, teamId)).returning({ id: team.id }).all();
    return deleted.length > 0;
  });
}

/** Notice batches one person can trigger per minute (invites, shared apps). */
export const NOTICES_PER_SENDER_PER_MINUTE = 10;
const NOTICE_WINDOW_MS = 60_000;
const noticeRates = new Map<string, { startedAt: number; count: number }>();

function noticeRateLimited(senderUserId: string): boolean {
  const now = Date.now();
  const current = noticeRates.get(senderUserId);
  if (!current || now - current.startedAt >= NOTICE_WINDOW_MS) {
    if (noticeRates.size > 10_000) noticeRates.clear();
    noticeRates.set(senderUserId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > NOTICES_PER_SENDER_PER_MINUTE;
}

/** Forgets every sender's notice window (tests). */
export function resetNoticeRates(): void {
  noticeRates.clear();
}

export interface HarkNotice {
  /** The member whose action caused the notice; their budget is charged. */
  senderUserId: string;
  title: string;
  body: string;
  sourceName: string;
  url?: string;
  appId?: string;
  /** Groups the pushes into one conversation on the phone. */
  conversationKey: string;
}

/**
 * Sends SHark's own notice (an invite, a shared app) to users: one inbox row
 * each, pushed to their active iPhones in the regular webhook shape so a tap
 * opens `url` or the app. Not counted against anyone's allowance, but each
 * sender may trigger at most {@link NOTICES_PER_SENDER_PER_MINUTE} a minute;
 * notices past that are dropped.
 */
export async function sendNotice(userIds: string[], notice: HarkNotice): Promise<number> {
  if (userIds.length === 0) return 0;
  if (noticeRateLimited(notice.senderUserId)) {
    console.warn("[teams] Notice dropped: sender rate limit exceeded");
    return 0;
  }
  const now = new Date();
  let accepted = 0;
  for (const userId of userIds) {
    const id = newId("anot");
    await db.insert(agentNotification).values({
      id,
      userId,
      requesterTokenId: null,
      sourceName: notice.sourceName,
      title: notice.title,
      body: notice.body,
      url: notice.url ?? null,
      appId: notice.appId ?? null,
      createdAt: now,
    });
    const devices = await db
      .select({ token: device.expoPushToken })
      .from(device)
      .where(and(eq(device.userId, userId), eq(device.active, true), eq(device.platform, "ios")));
    if (devices.length === 0) {
      await db
        .update(agentNotification)
        .set({ status: "no_devices" })
        .where(eq(agentNotification.id, id));
      continue;
    }
    let delivered = 0;
    try {
      const result = await sendPushMessages(
        buildPushMessages({
          to: devices.map((row) => row.token),
          eventId: id,
          serviceId: "hark-teams",
          conversationKey: notice.conversationKey,
          ...(notice.appId ? { appId: notice.appId } : {}),
          resolved: {
            title: notice.title,
            body: notice.body,
            ...(notice.url ? { url: notice.url } : {}),
          },
        }),
      );
      delivered = result.accepted;
      if (result.staleTokens.length > 0) {
        await db
          .update(device)
          .set({ active: false })
          .where(inArray(device.expoPushToken, result.staleTokens));
      }
    } catch (error) {
      // Provider errors can embed push tokens, so only the error's class is logged.
      console.error("[teams] Notice push threw", errorClass(error));
    }
    await db
      .update(agentNotification)
      .set({
        status: delivered === devices.length ? "accepted" : delivered > 0 ? "partial" : "failed",
        acceptedCount: delivered,
        failedCount: devices.length - delivered,
        // Provider errors can embed push tokens, so the stored reason is deliberately coarse.
        error: delivered < devices.length ? "Push delivery failed" : null,
      })
      .where(eq(agentNotification.id, id));
    accepted += delivered;
  }
  return accepted;
}

/** An error's class name, safe to log where its message could carry credentials. */
export function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
