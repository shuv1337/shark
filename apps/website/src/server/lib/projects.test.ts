import { MAX_PROJECTS_PER_ACCOUNT } from "@hark/contracts";
import { count, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let resolveProjectForDelivery: typeof import("./projects")["resolveProjectForDelivery"];

const USER = "user_cap";
const OTHER_USER = "user_other";

async function projectCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.project)
    .where(eq(schema.project.userId, userId));
  return row?.value ?? 0;
}

async function seedProjects(userId: string, from: number, to: number): Promise<void> {
  const now = new Date();
  for (let start = from; start < to; start += 100) {
    const end = Math.min(start + 100, to);
    await db.insert(schema.project).values(
      Array.from({ length: end - start }, (_, offset) => {
        const index = start + offset;
        return {
          id: `prj_seed_${userId}_${index}`,
          userId,
          name: `Seed ${index}`,
          normalizedName: `seed ${index}`,
          createdAt: now,
          updatedAt: now,
        };
      }),
    );
  }
}

beforeAll(async () => {
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ resolveProjectForDelivery } = await import("./projects"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values(
    [USER, OTHER_USER].map((id) => ({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
});

describe("resolveProjectForDelivery", () => {
  it("creates a project once and reuses it case-insensitively", async () => {
    const first = await resolveProjectForDelivery(OTHER_USER, "Acme App");
    expect(first.projectId).toBeTruthy();
    expect(first.message).toBeUndefined();

    const again = await resolveProjectForDelivery(OTHER_USER, "ACME APP");
    expect(again.projectId).toBe(first.projectId);
    expect(await projectCount(OTHER_USER)).toBe(1);
  });

  it("collapses a same-name concurrent race onto one project", async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => resolveProjectForDelivery(OTHER_USER, "Same Name Race")),
    );
    const ids = new Set(results.map((result) => result.projectId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
    expect(results.every((result) => result.message === undefined)).toBe(true);
    expect(await projectCount(OTHER_USER)).toBe(2);
  });

  it("never exceeds the cap under concurrent distinct-name deliveries", async () => {
    // One slot left: capacity-1 projects exist before the burst.
    await seedProjects(USER, 0, MAX_PROJECTS_PER_ACCOUNT - 1);
    expect(await projectCount(USER)).toBe(MAX_PROJECTS_PER_ACCOUNT - 1);

    // Every request awaits its own reads and writes, so a plain
    // count-then-insert interleaves at those await points and would create
    // all eight projects. The atomic conditional insert admits exactly one.
    const burst = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        resolveProjectForDelivery(USER, `Distinct burst ${index}`),
      ),
    );

    const created = burst.filter((result) => result.projectId !== null);
    const degraded = burst.filter((result) => result.projectId === null);
    expect(created).toHaveLength(1);
    expect(degraded).toHaveLength(7);
    // Degraded deliveries never fail; they carry the additive cap message.
    for (const result of degraded) {
      expect(result.message).toContain(`${MAX_PROJECTS_PER_ACCOUNT}`);
    }
    expect(await projectCount(USER)).toBe(MAX_PROJECTS_PER_ACCOUNT);
  });

  it("keeps degrading to Unfiled at the cap without failing the delivery", async () => {
    expect(await projectCount(USER)).toBe(MAX_PROJECTS_PER_ACCOUNT);
    const result = await resolveProjectForDelivery(USER, "One project too many");
    expect(result).toEqual({
      projectId: null,
      message: `Project limit reached (${MAX_PROJECTS_PER_ACCOUNT} per account); the notification was stored without a project.`,
    });
    expect(await projectCount(USER)).toBe(MAX_PROJECTS_PER_ACCOUNT);
  });

  it("still resolves existing names at the cap instead of degrading", async () => {
    const existing = await resolveProjectForDelivery(USER, "Seed 42");
    expect(existing).toEqual({ projectId: `prj_seed_${USER}_42` });

    // Same-name race at the very cap: both calls adopt the winner's row.
    const winner = await projectCount(USER);
    const results = await Promise.all([
      resolveProjectForDelivery(USER, "seed 7"),
      resolveProjectForDelivery(USER, "SEED 7"),
    ]);
    expect(results.map((result) => result.projectId)).toEqual([
      `prj_seed_${USER}_7`,
      `prj_seed_${USER}_7`,
    ]);
    expect(await projectCount(USER)).toBe(winner);
  });

  it("does not let one account's cap affect another account", async () => {
    const result = await resolveProjectForDelivery(OTHER_USER, "Unaffected by cap");
    expect(result.projectId).toBeTruthy();
    expect(result.message).toBeUndefined();
  });
});
