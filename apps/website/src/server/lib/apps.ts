import { type AppDto, type AppSummaryDto, appOrigin } from "@hark/contracts";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { apiToken, app } from "../db/schema";

export type AppRow = typeof app.$inferSelect;

/** Selection shared by every AppDto read: the app plus its display joins. */
export function selectAppsWithJoins() {
  return db
    .select({ app, createdBy: apiToken.name })
    .from(app)
    .leftJoin(apiToken, eq(apiToken.id, app.createdByTokenId));
}

export function toAppDto(row: { app: AppRow; createdBy: string | null }): AppDto {
  const { app: value } = row;
  return {
    id: value.id,
    name: value.name,
    origin: value.origin,
    iconUrl: value.iconUrl,
    url: value.url,
    shareName: value.shareName,
    shareEmail: value.shareEmail,
    consentedAt: value.consentedAt?.toISOString() ?? null,
    lastOpenedAt: value.lastOpenedAt?.toISOString() ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
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

/** Loads one app as a DTO, scoped to its owner. */
export async function ownedAppDto(userId: string, appId: string): Promise<AppDto | undefined> {
  const [row] = await selectAppsWithJoins()
    .where(and(eq(app.id, appId), eq(app.userId, userId)))
    .limit(1);
  return row ? toAppDto(row) : undefined;
}

export type NotificationAppResolution = { ok: true; app: AppRow } | { ok: false; error: string };

/**
 * Validates a notification's `appId`: the app must belong to the sender's
 * account, and an explicit tap URL must stay on the app's origin so the
 * signed pass is never handed to a different site.
 */
export async function resolveNotificationApp(
  userId: string,
  appId: string,
  url: string | undefined,
): Promise<NotificationAppResolution> {
  const [row] = await db
    .select()
    .from(app)
    .where(and(eq(app.id, appId), eq(app.userId, userId)))
    .limit(1);
  if (!row) return { ok: false, error: "Unknown app" };
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
