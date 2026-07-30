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
  database.pragma("foreign_keys = ON");
  database.exec(`
    create table user (id text primary key);
    create table service (
      id text primary key, user_id text not null, title text not null, image_url text
    );
    create table api_token (
      id text primary key, user_id text not null, name text not null
    );
    create table event (
      id text primary key, service_id text not null, title text not null, body text not null,
      image_url text, url text, status text not null, delivered_count integer not null,
      error text, created_at integer not null
    );
    create table agent_notification (
      id text primary key, user_id text not null, requester_token_id text not null,
      title text not null, body text not null, image_url text, url text,
      accepted_count integer not null, created_at integer not null
    );
    create table interaction (
      id text primary key, user_id text not null, requester_token_id text,
      requester_service_id text, event_id text, title text not null, prompt text not null,
      image_url text, url text, status text not null, response text, accepted_count integer not null,
      expires_at integer not null, created_at integer not null, responded_at integer,
      canceled_at integer
    );
    create table live_activity (
      id text primary key, user_id text not null, requester_token_id text,
      requester_service_id text, interaction_id text, props text not null, status text not null,
      accepted_count integer not null, failed_count integer not null, expires_at integer not null,
      created_at integer not null, updated_at integer not null
    );
    create table live_activity_operation (
      id text primary key, activity_id text not null, event text not null,
      accepted_count integer not null, failed_count integer not null, created_at integer not null
    );
    create table live_activity_delivery_attempt (
      id text primary key, activity_id text not null, apns_status integer,
      apns_reason text, created_at integer not null
    );
  `);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("durable inbox migrations", () => {
  it("backfills existing sources and upgrades direct-notification delivery state", () => {
    const database = legacyDatabase();
    const now = Date.parse("2026-07-30T12:00:00.000Z");
    database.exec(`
      insert into user values ('user_1');
      insert into service values ('svc_1', 'user_1', 'Original source', null);
      insert into api_token values ('tok_1', 'user_1', 'Release agent');
      insert into event values (
        'evt_1', 'svc_1', 'Build passed', 'Production is healthy',
        null, null, 'accepted', 1, null, ${now}
      );
      insert into agent_notification values (
        'anot_1', 'user_1', 'tok_1', 'Deploy complete', 'Version 2 is live',
        null, null, 2, ${now + 1}
      );
      insert into interaction values (
        'int_1', 'user_1', 'tok_1', null, null, 'Approve deploy', 'Ship version 3?',
        null, null, 'approved', null, 1, ${now + 60_000}, ${now + 2}, ${now + 3}, null
      );
      insert into live_activity values (
        'act_1', 'user_1', 'tok_1', null, null,
        '{"title":"Deploying","status":"Running","detail":"Uploading"}',
        'ended', 1, 0, ${now + 60_000}, ${now + 4}, ${now + 5}
      );
      insert into live_activity_operation values (
        'op_1', 'act_1', 'end', 1, 0, ${now + 5}
      );
    `);

    applyMigration(database, "0016_slim_dorian_gray.sql");
    applyMigration(database, "0017_overjoyed_molten_man.sql");

    const items = database
      .prepare(
        "select entity_type as entityType, source_name as sourceName, status, accepted_count as accepted from inbox_item order by entity_type",
      )
      .all() as Array<Record<string, unknown>>;
    expect(items).toEqual([
      {
        entityType: "agent_notification",
        sourceName: "Release agent",
        status: "accepted",
        accepted: 2,
      },
      {
        entityType: "event",
        sourceName: "Original source",
        status: "accepted",
        accepted: 1,
      },
      {
        entityType: "interaction",
        sourceName: "Release agent",
        status: "approved",
        accepted: 1,
      },
      {
        entityType: "live_activity",
        sourceName: "Release agent",
        status: "ended",
        accepted: 1,
      },
    ]);
    expect(
      database
        .prepare("select count(*) as value from inbox_item_event where inbox_item_id = ?")
        .get("ibox:live_activity:act_1"),
    ).toEqual({ value: 2 });

    database.prepare("update service set title = ? where id = ?").run("Renamed", "svc_1");
    expect(
      database
        .prepare("select source_name as sourceName from inbox_item where entity_id = ?")
        .get("evt_1"),
    ).toEqual({ sourceName: "Original source" });

    database.prepare("delete from interaction where id = ?").run("int_1");
    expect(
      database
        .prepare(
          "select status, result, needs_action as needsAction from inbox_item where entity_id = ?",
        )
        .get("int_1"),
    ).toEqual({ status: "approved", result: "Approved", needsAction: 0 });
    expect(
      database
        .prepare(
          "select result from inbox_item_event where inbox_item_id = ? and kind = 'source_deleted'",
        )
        .get("ibox:interaction:int_1"),
    ).toEqual({ result: "approved" });
  });
});
