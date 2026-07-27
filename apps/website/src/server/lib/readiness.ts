import type Database from "better-sqlite3";
import { sqlite } from "../db";
import { databaseContractIssue } from "../db/contract";

export { EXPECTED_MIGRATION_COUNT, EXPECTED_MIGRATION_CREATED_AT } from "../db/contract";

/**
 * Performs bounded, read-only checks against the live database. Keep failures
 * private: callers expose only a generic unavailable response.
 */
export function databaseIsReady(database: Database.Database = sqlite): boolean {
  try {
    return databaseContractIssue(database) === null;
  } catch {
    return false;
  }
}
