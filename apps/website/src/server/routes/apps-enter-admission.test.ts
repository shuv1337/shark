import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APP_URL = "https://shark.example";

let app: typeof import("../app")["app"];
let issueAppPass: typeof import("../lib/app-pass")["issueAppPass"];
let allowedEmails: string[];

const OWNER = { id: "user_owner", name: "Cap", email: "owner@example.com" };
const MEMBER = { id: "user_member", name: "Mo", email: "member@example.com" };
type Person = typeof OWNER;

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ issueAppPass } = await import("../lib/app-pass"));
  const { env } = await import("../env");
  allowedEmails = env.ALLOWED_EMAILS;
  allowedEmails.splice(0, allowedEmails.length, OWNER.email, MEMBER.email);
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values(
    [OWNER, MEMBER].map((person) => ({
      ...person,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db
    .insert(schema.team)
    .values({ id: "team_1", name: "Crew", createdAt: now, updatedAt: now });
  await db.insert(schema.teamMember).values(
    [OWNER, MEMBER].map((person) => ({
      teamId: "team_1",
      userId: person.id,
      role: person === OWNER ? "owner" : "member",
      joinedAt: now,
    })),
  );
  await db.insert(schema.app).values({
    id: "app_teamboard",
    userId: OWNER.id,
    name: "Team board",
    url: "https://shark.example/board?team=1",
    origin: "https://shark.example",
    teamId: "team_1",
    shareName: true,
    shareEmail: false,
    consentedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.appMemberState).values(
    [OWNER, MEMBER].map((person) => ({
      appId: "app_teamboard",
      userId: person.id,
      consentedAt: now,
      updatedAt: now,
    })),
  );
});

afterAll(() => {
  allowedEmails.splice(0, allowedEmails.length);
});

async function teamPass(user: Person): Promise<string> {
  const issued = await issueAppPass({
    user,
    app: {
      id: "app_teamboard",
      origin: "https://shark.example",
      shareName: true,
      shareEmail: false,
    },
  });
  return issued.token;
}

async function enter(pass: string): Promise<Response> {
  return app.request("/apps/enter", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-shark-entry": "1",
    },
    body: new URLSearchParams({ pass, next: "/board" }).toString(),
  });
}

describe("POST /apps/enter with real sessions", () => {
  it("opens no session for a consented member who left the email allowlist", async () => {
    const admitted = await enter(await teamPass(MEMBER));
    expect(admitted.status).toBe(303);
    expect(admitted.headers.get("set-cookie")).toContain("session_token=");

    const issuedWhileAllowed = await teamPass(MEMBER);
    allowedEmails.splice(allowedEmails.indexOf(MEMBER.email), 1);
    const refused = await enter(issuedWhileAllowed);
    expect(refused.status).toBe(403);
    expect(refused.headers.get("set-cookie")).toBeNull();
  });
});
