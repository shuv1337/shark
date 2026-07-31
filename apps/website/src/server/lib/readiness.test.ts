import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  databaseIsReady,
  EXPECTED_MIGRATION_COUNT,
  EXPECTED_MIGRATION_CREATED_AT,
} from "./readiness";

const databases: Database.Database[] = [];

function makeDatabase(options?: { migrationCount?: number; latest?: number }) {
  const database = new Database(":memory:");
  databases.push(database);
  database.exec(`
    create table "__drizzle_migrations" (
      id integer primary key autoincrement,
      hash text not null,
      created_at numeric
    );
    ${[
      "user",
      "session",
      "account",
      "service",
      "device",
      "watch_device",
      "watch_action",
      "event",
      "api_token",
      "interaction",
      "live_activity",
      "live_activity_delivery",
      "inbox_item",
      "inbox_item_event",
    ]
      .map((name) => `create table "${name}" (id text primary key);`)
      .join("\n")}
  `);
  const count = options?.migrationCount ?? EXPECTED_MIGRATION_COUNT;
  const insert = database.prepare(
    'insert into "__drizzle_migrations" (hash, created_at) values (?, ?)',
  );
  for (let index = 0; index < count; index += 1) {
    const latest = options?.latest ?? EXPECTED_MIGRATION_CREATED_AT;
    insert.run(`hash-${index}`, index === count - 1 ? latest : index);
  }
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("databaseIsReady", () => {
  it("accepts the exact expected schema", () => {
    expect(databaseIsReady(makeDatabase())).toBe(true);
  });

  it("rejects incomplete or unexpected migration state", () => {
    expect(databaseIsReady(makeDatabase({ migrationCount: EXPECTED_MIGRATION_COUNT - 1 }))).toBe(
      false,
    );
    expect(databaseIsReady(makeDatabase({ latest: EXPECTED_MIGRATION_CREATED_AT - 1 }))).toBe(
      false,
    );
  });
});
