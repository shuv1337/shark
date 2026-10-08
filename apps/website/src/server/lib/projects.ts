import { MAX_PROJECTS_PER_ACCOUNT, normalizeProjectName } from "@hark/contracts";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { project } from "../db/schema";
import { newId } from "./id";

export interface ProjectResolution {
  projectId: string | null;
  /** Additive human-readable note when the delivery degraded to Unfiled. */
  message?: string;
}

const CAP_MESSAGE = `Project limit reached (${MAX_PROJECTS_PER_ACCOUNT} per account); the notification was stored without a project.`;

async function findProjectId(userId: string, normalizedName: string): Promise<string | null> {
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.userId, userId), eq(project.normalizedName, normalizedName)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Resolves a sender-supplied project display name to the owning user's
 * project, creating it when new. Identity is NFC + case-insensitive within
 * the account, and concurrent creations collapse onto the unique index
 * instead of failing the delivery. When the account already holds the
 * maximum number of projects, the notification is delivered Unfiled and the
 * caller receives an additive message rather than an error.
 */
export async function resolveProjectForDelivery(
  userId: string,
  rawName: string,
): Promise<ProjectResolution> {
  const name = rawName.normalize("NFC");
  const normalizedName = normalizeProjectName(rawName);

  const existing = await findProjectId(userId, normalizedName);
  if (existing) return { projectId: existing };

  const now = Date.now();
  const id = newId("prj");
  let inserted: number;
  try {
    // The cap check and the insert execute as one atomic SQLite statement,
    // so concurrent distinct-name deliveries can never push an account past
    // MAX_PROJECTS_PER_ACCOUNT: whichever statement runs second already sees
    // the first one's row. A plain count-then-insert would let two requests
    // at capacity-1 both pass the check across their await points.
    const result = db.run(sql`
      insert into ${project} (id, user_id, name, normalized_name, created_at, updated_at)
      select ${id}, ${userId}, ${name}, ${normalizedName}, ${now}, ${now}
      where (
        select count(*) from ${project} where user_id = ${userId}
      ) < ${MAX_PROJECTS_PER_ACCOUNT}
    `);
    inserted = result.changes;
  } catch (error) {
    // A concurrent request created the same name; adopt that row.
    const raced = await findProjectId(userId, normalizedName);
    if (raced) return { projectId: raced };
    throw error;
  }
  if (inserted > 0) return { projectId: id };

  // The cap gate stopped the insert. A concurrent delivery may have created
  // this very name while filling the final slot, so prefer adopting it over
  // degrading the delivery to Unfiled.
  const raced = await findProjectId(userId, normalizedName);
  if (raced) return { projectId: raced };
  return { projectId: null, message: CAP_MESSAGE };
}
