import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { databaseBackupContractIssue, KNOWN_MIGRATION_CREATED_AT } from "./contract";

const databases: Database.Database[] = [];

function makeDatabase(createdAt: readonly number[]) {
  const database = new Database(":memory:");
  databases.push(database);
  database.exec(`
    create table "__drizzle_migrations" (
      id integer primary key autoincrement,
      hash text not null,
      created_at numeric
    );
  `);
  const insert = database.prepare(
    'insert into "__drizzle_migrations" (hash, created_at) values (?, ?)',
  );
  createdAt.forEach((timestamp, index) => {
    insert.run(`hash-${index}`, timestamp);
  });
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("databaseBackupContractIssue", () => {
  it("accepts the current migration version", () => {
    expect(databaseBackupContractIssue(makeDatabase(KNOWN_MIGRATION_CREATED_AT))).toBeNull();
  });

  it("accepts a known pre-migration database for a safe deployment backup", () => {
    expect(
      databaseBackupContractIssue(makeDatabase(KNOWN_MIGRATION_CREATED_AT.slice(0, -1))),
    ).toBeNull();
  });

  it("rejects unknown, empty, and future migration states", () => {
    const knownPrefix = KNOWN_MIGRATION_CREATED_AT.slice(0, -1);
    expect(databaseBackupContractIssue(makeDatabase([...knownPrefix.slice(0, -1), 123]))).toBe(
      "Database has an unexpected migration version.",
    );
    expect(databaseBackupContractIssue(makeDatabase([]))).toBe(
      "Database has an unexpected migration version.",
    );
    expect(databaseBackupContractIssue(makeDatabase([...KNOWN_MIGRATION_CREATED_AT, 123]))).toBe(
      "Database has an unexpected migration version.",
    );
  });
});
