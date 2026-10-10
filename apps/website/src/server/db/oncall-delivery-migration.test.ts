import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const databases: Database.Database[] = [];

function applyMigration(database: Database.Database, name: string) {
  const source = readFileSync(resolve(process.cwd(), "drizzle", name), "utf8");
  for (const statement of source.split("--> statement-breakpoint")) {
    if (statement.trim()) database.exec(statement);
  }
}

function legacyDatabase() {
  const database = new Database(":memory:");
  databases.push(database);
  database.exec(`
    create table oncall_page (
      id text primary key, status text not null, created_at integer not null
    );
    create table oncall_page_recipient (
      page_id text not null, user_id text not null, accepted_count integer not null,
      notified_at integer not null, primary key (page_id, user_id)
    );
  `);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("oncall delivery status migration", () => {
  it("schedules a spread-out first retry only for recent open pages", () => {
    const database = legacyDatabase();
    const now = Date.now();
    const day = 86_400_000;
    const page = database.prepare("insert into oncall_page values (?, ?, ?)");
    page.run("recent", "triggered", now - 60_000);
    page.run("old", "triggered", now - day - 60_000);
    page.run("closed", "resolved", now - 60_000);
    const recipient = database.prepare("insert into oncall_page_recipient values (?, ?, ?, ?)");
    recipient.run("recent", "reached", 1, now);
    recipient.run("recent", "missed", 0, now);
    recipient.run("old", "missed", 0, now);
    recipient.run("closed", "missed", 0, now);

    applyMigration(database, "0028_oncall_delivery_status.sql");

    const rows = database
      .prepare(
        `select page_id, user_id, delivery_status, delivery_attempts, next_attempt_at
         from oncall_page_recipient order by page_id, user_id`,
      )
      .all() as Array<{
      page_id: string;
      user_id: string;
      delivery_status: string;
      delivery_attempts: number;
      next_attempt_at: number | null;
    }>;
    const byKey = new Map(rows.map((row) => [`${row.page_id}/${row.user_id}`, row]));
    expect(rows.every((row) => row.delivery_attempts === 1)).toBe(true);
    expect(byKey.get("recent/reached")).toMatchObject({
      delivery_status: "delivered",
      next_attempt_at: null,
    });
    expect(byKey.get("old/missed")).toMatchObject({
      delivery_status: "failed",
      next_attempt_at: null,
    });
    expect(byKey.get("closed/missed")).toMatchObject({
      delivery_status: "failed",
      next_attempt_at: null,
    });
    const scheduled = byKey.get("recent/missed")?.next_attempt_at ?? 0;
    expect(scheduled).toBeGreaterThanOrEqual(now + 60_000);
    expect(scheduled).toBeLessThan(Date.now() + 360_000);
  });
});
