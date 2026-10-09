import { type AppDto, type AppSummaryDto, appOrigin, type TeamRole } from "@hark/contracts";
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  apiToken,
  app,
  appMemberState,
  project,
  team,
  teamMember,
  user as userTable,
} from "../db/schema";

export type AppRow = typeof app.$inferSelect;
type MemberStateRow = typeof appMemberState.$inferSelect;

/** Team IDs the user belongs to, as a subquery. */
export function memberTeamIds(userId: string) {
  return db.select({ id: teamMember.teamId }).from(teamMember).where(eq(teamMember.userId, userId));
}

/**
 * Apps a viewer can see: their own personal apps plus every app of the teams
 * they belong to. Leaving a team removes its apps from this set immediately.
 */
export function visibleAppsFilter(viewerId: string): SQL {
  return or(
    and(eq(app.userId, viewerId), isNull(app.teamId)),
    inArray(app.teamId, memberTeamIds(viewerId)),
  ) as SQL;
}

/** Selection shared by every AppDto read: the app, its display joins, and the viewer's state. */
export function selectAppsWithJoins(viewerId: string) {
  return db
    .select({
      app,
      projectName: project.name,
      createdBy: apiToken.name,
      teamName: team.name,
      addedBy: userTable.name,
      state: appMemberState,
    })
    .from(app)
    .leftJoin(project, eq(project.id, app.projectId))
    .leftJoin(apiToken, eq(apiToken.id, app.createdByTokenId))
    .leftJoin(team, eq(team.id, app.teamId))
    .leftJoin(userTable, eq(userTable.id, app.userId))
    .leftJoin(
      appMemberState,
      and(eq(appMemberState.appId, app.id), eq(appMemberState.userId, viewerId)),
    );
}

export function toAppDto(
  row: {
    app: AppRow;
    projectName: string | null;
    createdBy: string | null;
    teamName?: string | null;
    addedBy?: string | null;
    state?: MemberStateRow | null;
  },
  viewerId: string,
): AppDto {
  const { app: value } = row;
  const teamApp = value.teamId !== null;
  // A project belongs to the member who filed the app; others see no project.
  const ownProject = value.userId === viewerId;
  const sharing = teamApp
    ? {
        shareName: row.state?.shareName ?? true,
        shareEmail: row.state?.shareEmail ?? false,
        consentedAt: row.state?.consentedAt?.toISOString() ?? null,
        lastOpenedAt: row.state?.lastOpenedAt?.toISOString() ?? null,
      }
    : {
        shareName: value.shareName,
        shareEmail: value.shareEmail,
        consentedAt: value.consentedAt?.toISOString() ?? null,
        lastOpenedAt: value.lastOpenedAt?.toISOString() ?? null,
      };
  return {
    id: value.id,
    name: value.name,
    origin: value.origin,
    iconUrl: value.iconUrl,
    url: value.url,
    projectId: ownProject ? value.projectId : null,
    projectName: ownProject && value.projectId ? row.projectName : null,
    ...sharing,
    createdBy: row.createdBy ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    team: teamApp && value.teamId ? { id: value.teamId, name: row.teamName ?? "" } : null,
    addedBy: row.addedBy ?? null,
  };
}

export function toAppSummaryDto(value: Pick<AppRow, "id" | "name" | "origin" | "iconUrl">) {
  return {
    id: value.id,
    name: value.name,
    origin: value.origin,
    iconUrl: value.iconUrl,
  } satisfies AppSummaryDto;
}

/** Loads one app the viewer can see (personal or one of their teams') as a DTO. */
export async function visibleAppDto(viewerId: string, appId: string): Promise<AppDto | undefined> {
  const [row] = await selectAppsWithJoins(viewerId)
    .where(and(eq(app.id, appId), visibleAppsFilter(viewerId)))
    .limit(1);
  return row ? toAppDto(row, viewerId) : undefined;
}

export interface AppAccess {
  app: AppRow;
  /** The viewer's role in the app's team; null for personal apps. */
  role: TeamRole | null;
}

/** The app plus the viewer's team role, when the viewer can see it. */
export async function appAccess(viewerId: string, appId: string): Promise<AppAccess | undefined> {
  const [row] = await db
    .select({ app, role: teamMember.role })
    .from(app)
    .leftJoin(teamMember, and(eq(teamMember.teamId, app.teamId), eq(teamMember.userId, viewerId)))
    .where(and(eq(app.id, appId), visibleAppsFilter(viewerId)))
    .limit(1);
  if (!row) return undefined;
  return { app: row.app, role: row.app.teamId ? ((row.role as TeamRole | null) ?? null) : null };
}

/** Owner of a personal app, the member who added a team app, or a team admin. */
export function canManageApp(viewerId: string, access: AppAccess): boolean {
  if (access.app.userId === viewerId) return true;
  return access.role === "owner" || access.role === "admin";
}

export type NotificationAppResolution = { ok: true; app: AppRow } | { ok: false; error: string };

/**
 * Validates a notification's `appId`: the app must be one the sender can
 * open (their own or one of their teams'), and an explicit tap URL must
 * stay on the app's origin so the signed pass is never handed to a
 * different site.
 */
export async function resolveNotificationApp(
  userId: string,
  appId: string,
  url: string | undefined,
): Promise<NotificationAppResolution> {
  const [row] = await db
    .select()
    .from(app)
    .where(and(eq(app.id, appId), visibleAppsFilter(userId)))
    .limit(1);
  if (!row) return { ok: false, error: "Unknown app" };
  return checkAppUrl(row, url);
}

export function checkAppUrl(row: AppRow, url: string | undefined): NotificationAppResolution {
  if (url !== undefined) {
    let origin: string | null;
    try {
      origin = appOrigin(url);
    } catch {
      origin = null;
    }
    if (origin !== row.origin) {
      return { ok: false, error: `url must be on the app's origin (${row.origin})` };
    }
  }
  return { ok: true, app: row };
}
