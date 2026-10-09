import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const databases: Database.Database[] = [];
const migrationRoot = resolve(process.cwd(), "drizzle");
const journal = JSON.parse(readFileSync(resolve(migrationRoot, "meta/_journal.json"), "utf8")) as {
  entries: Array<{ tag: string }>;
};

function migrate(database: Database.Database, entries: typeof journal.entries) {
  database.pragma("foreign_keys = OFF");
  database.transaction(() => {
    for (const entry of entries) {
      const source = readFileSync(resolve(migrationRoot, `${entry.tag}.sql`), "utf8");
      for (const statement of source.split("--> statement-breakpoint")) database.exec(statement);
    }
  })();
  database.pragma("foreign_keys = ON");
}

function previousDatabase() {
  const database = new Database(":memory:");
  databases.push(database);
  migrate(database, journal.entries.slice(0, 23));
  database.exec(`
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
      VALUES ('owner', 'Owner', 'owner@example.test', 1, 1, 1);
    INSERT INTO service (id, user_id, title, token_hash, created_at, updated_at)
      VALUES ('svc', 'owner', 'Source', 'synthetic-hash', 1, 1);
    INSERT INTO api_token (id, user_id, name, token_hash, prefix, scopes, created_at)
      VALUES ('tok', 'owner', 'Agent', 'synthetic-agent-hash', 'synthetic', '[]', 1);
    INSERT INTO event (id, service_id, title, body, status, created_at)
      VALUES ('evt', 'svc', 'Before merge', 'Kept body', 'accepted', 1);
    INSERT INTO agent_notification (id, user_id, requester_token_id, title, body, created_at)
      VALUES ('anot', 'owner', 'tok', 'Agent before merge', 'Kept agent body', 2);
  `);
  return database;
}

function project(database: Database.Database, entity: string, id: string, readAt: number | null) {
  database
    .prepare(`INSERT INTO inbox_item
    (id, user_id, entity_type, entity_id, kind, source_name, title, body, status,
      read_at, occurred_at, updated_at)
    VALUES (?, 'owner', ?, ?, 'notification', 'Source', 'Title', 'Body', 'accepted', ?, 1, 1)
    ON CONFLICT(entity_type, entity_id) DO UPDATE SET read_at = excluded.read_at
  `)
    .run(`ibox:${entity}:${id}`, entity, id, readAt);
}

const readAt = (database: Database.Database, table: string, id: string) =>
  (
    database.prepare(`SELECT read_at FROM ${table} WHERE id = ?`).get(id) as {
      read_at: number | null;
    }
  ).read_at;

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("upstream merge migration", () => {
  it("upgrades the existing SHark history without losing read state or source data", () => {
    const database = previousDatabase();
    project(database, "event", "evt", 123);
    project(database, "agent_notification", "anot", 456);
    migrate(database, journal.entries.slice(23));
    expect(readAt(database, "event", "evt")).toBe(123);
    expect(readAt(database, "agent_notification", "anot")).toBe(456);
    expect(database.prepare("SELECT body FROM event WHERE id = 'evt'").get()).toEqual({
      body: "Kept body",
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'board_%' AND type = 'table'")
        .all(),
    ).toHaveLength(4);
  });

  it("synchronizes both inbox generations, including lazy materialization and recursive triggers", () => {
    const database = previousDatabase();
    migrate(database, journal.entries.slice(23));
    database.pragma("recursive_triggers = ON");
    database.exec("DELETE FROM inbox_item");
    database.exec("UPDATE event SET read_at = 123 WHERE id = 'evt'");
    project(database, "event", "evt", null);
    project(database, "agent_notification", "anot", null);
    expect(readAt(database, "inbox_item", "ibox:event:evt")).toBe(123);
    database.exec("UPDATE event SET read_at = NULL WHERE id = 'evt'");
    expect(readAt(database, "inbox_item", "ibox:event:evt")).toBeNull();
    database.exec("UPDATE inbox_item SET read_at = 789");
    expect(readAt(database, "event", "evt")).toBe(789);
    expect(readAt(database, "agent_notification", "anot")).toBe(789);
    database.exec("UPDATE agent_notification SET read_at = NULL WHERE id = 'anot'");
    expect(readAt(database, "inbox_item", "ibox:agent_notification:anot")).toBeNull();
    database.exec("DELETE FROM service WHERE id = 'svc'");
    expect(readAt(database, "inbox_item", "ibox:event:evt")).toBe(789);
  });

  it("retains notifications and apps when a project is deleted", () => {
    const database = previousDatabase();
    migrate(database, journal.entries.slice(23));
    database.exec(`
      INSERT INTO project (id, user_id, name, normalized_name, created_at, updated_at)
        VALUES ('prj', 'owner', 'Project', 'project', 1, 1);
      UPDATE event SET project_id = 'prj';
      UPDATE agent_notification SET project_id = 'prj';
      INSERT INTO app (id, user_id, name, url, origin, project_id, created_at, updated_at)
        VALUES ('app', 'owner', 'App', 'https://example.test/', 'https://example.test', 'prj', 1, 1);
      DELETE FROM project WHERE id = 'prj';
    `);
    for (const table of ["event", "agent_notification", "app"]) {
      expect(database.prepare(`SELECT project_id FROM ${table}`).all()).toEqual([
        { project_id: null },
      ]);
    }
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  it("rebuilds agent_notification for teams without losing rowids, delivery state, or inbox sync", () => {
    const database = previousDatabase();
    migrate(database, journal.entries.slice(23, 24));
    database.exec(`
      UPDATE agent_notification SET status = 'failed', failed_count = 2, error = 'Unregistered'
        WHERE id = 'anot';
    `);
    const before = database
      .prepare(
        "SELECT rowid, status, failed_count, error FROM agent_notification WHERE id = 'anot'",
      )
      .get();
    migrate(database, journal.entries.slice(24));
    expect(
      database
        .prepare(
          "SELECT rowid, status, failed_count, error FROM agent_notification WHERE id = 'anot'",
        )
        .get(),
    ).toEqual(before);

    database.exec(`
      INSERT INTO agent_notification (id, user_id, source_name, title, body, status, created_at)
        VALUES ('notice', 'owner', 'SHark', 'Team invite', 'Join Pushed', 'accepted', 3);
    `);
    expect(
      database
        .prepare("SELECT source_name FROM inbox_item WHERE id = 'ibox:agent_notification:notice'")
        .get(),
    ).toEqual({ source_name: "SHark" });
    database.exec("UPDATE inbox_item SET read_at = 42 WHERE id = 'ibox:agent_notification:notice'");
    expect(readAt(database, "agent_notification", "notice")).toBe(42);
    database.exec("UPDATE agent_notification SET status = 'withdrawn' WHERE id = 'anot'");
    expect(
      database
        .prepare("SELECT status FROM inbox_item WHERE id = 'ibox:agent_notification:anot'")
        .get(),
    ).toEqual({ status: "withdrawn" });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });
});
