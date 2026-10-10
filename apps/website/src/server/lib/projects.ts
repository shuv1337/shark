import { MAX_PROJECTS_PER_ACCOUNT, normalizeProjectName } from "@hark/contracts";
import { and, count, eq } from "drizzle-orm";
import { db, type Executor } from "../db";
import { project } from "../db/schema";
import { newId } from "./id";

export interface ProjectResolution {
  projectId: string | null;
  /** Additive human-readable note when the delivery degraded to Unfiled. */
  message?: string;
}

const CAP_MESSAGE = `Project limit reached (${MAX_PROJECTS_PER_ACCOUNT} per account); the notification was stored without a project.`;

/**
 * Resolves a sender-supplied project display name to the owning user's
 * project, creating it when new. Identity is NFC + case-insensitive within
 * the account. When the account already holds the maximum number of
 * projects, the notification is delivered Unfiled and the caller receives an
 * additive message rather than an error.
 *
 * Synchronous: inside a better-sqlite3 transaction the lookup, cap check,
 * and insert cannot interleave with another request, and a delivery that
 * creates the project inside its admission transaction leaves nothing
 * behind when it is refused or rolled back.
 */
export function resolveProject(
  executor: Executor,
  userId: string,
  rawName: string,
): ProjectResolution {
  const name = rawName.normalize("NFC");
  const normalizedName = normalizeProjectName(rawName);
  const existing = executor
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.userId, userId), eq(project.normalizedName, normalizedName)))
    .get();
  if (existing) return { projectId: existing.id };
  const total =
    executor.select({ value: count() }).from(project).where(eq(project.userId, userId)).get()
      ?.value ?? 0;
  if (total >= MAX_PROJECTS_PER_ACCOUNT) return { projectId: null, message: CAP_MESSAGE };
  const now = new Date();
  const id = newId("prj");
  executor
    .insert(project)
    .values({ id, userId, name, normalizedName, createdAt: now, updatedAt: now })
    .run();
  return { projectId: id };
}

/** {@link resolveProject} in its own transaction, for writes that are not counted deliveries. */
export async function resolveProjectForDelivery(
  userId: string,
  rawName: string,
): Promise<ProjectResolution> {
  return db.transaction((tx) => resolveProject(tx, userId, rawName));
}
