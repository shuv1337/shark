import type Database from "better-sqlite3";

export const EXPECTED_MIGRATION_COUNT = 16;
export const EXPECTED_MIGRATION_CREATED_AT = 1_785_282_742_299;
export const KNOWN_MIGRATION_CREATED_AT = [
  1_784_838_061_460, 1_784_844_109_833, 1_784_844_695_392, 1_784_857_552_207, 1_784_858_550_283,
  1_784_860_224_866, 1_784_860_882_450, 1_784_861_885_633, 1_784_916_448_420, 1_784_919_690_458,
  1_785_004_560_682, 1_785_016_656_904, 1_785_024_389_331, 1_785_027_353_868, 1_785_085_877_317,
  1_785_282_742_299,
] as const;

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

/**
 * Validates a database before backing it up during a deployment. The database
 * may legitimately be behind the image performing the backup because migrations
 * run only after the backup is safely captured. Only an exact, known prefix of
 * this build's migration history is accepted.
 */
export function databaseBackupContractIssue(database: Database.Database): string | null {
  const probe = database.prepare("select 1 as ok").get() as { ok?: number } | undefined;
  if (probe?.ok !== 1) return "Database probe failed.";

  const migrations = database
    .prepare('select count(*) as count, max(created_at) as latest from "__drizzle_migrations"')
    .get() as { count: number; latest: number | null };
  const expectedLatest = KNOWN_MIGRATION_CREATED_AT[migrations.count - 1];
  if (expectedLatest === undefined || migrations.latest !== expectedLatest) {
    return "Database has an unexpected migration version.";
  }

  return null;
}
