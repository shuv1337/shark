import type Database from "better-sqlite3";

export const EXPECTED_MIGRATION_COUNT = 16;
export const EXPECTED_MIGRATION_CREATED_AT = 1_785_282_742_299;

export const REQUIRED_TABLES = [
  "user",
  "session",
  "account",
  "service",
  "device",
  "event",
  "api_token",
  "interaction",
  "live_activity",
  "live_activity_delivery",
] as const;

/**
 * Returns a private operator-facing failure reason, or null when the database
 * matches the exact schema contract expected by this build.
 */
export function databaseContractIssue(database: Database.Database): string | null {
  const probe = database.prepare("select 1 as ok").get() as { ok?: number } | undefined;
  if (probe?.ok !== 1) return "Database probe failed.";

  const migrations = database
    .prepare('select count(*) as count, max(created_at) as latest from "__drizzle_migrations"')
    .get() as { count: number; latest: number | null };
  if (
    migrations.count !== EXPECTED_MIGRATION_COUNT ||
    migrations.latest !== EXPECTED_MIGRATION_CREATED_AT
  ) {
    return "Database has an unexpected migration version.";
  }

  const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
  const tables = database
    .prepare(
      `select count(*) as count from sqlite_master where type = 'table' and name in (${placeholders})`,
    )
    .get(...REQUIRED_TABLES) as { count: number };
  if (tables.count !== REQUIRED_TABLES.length) return "Database is missing required tables.";

  return null;
}
