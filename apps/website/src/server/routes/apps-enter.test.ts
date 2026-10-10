import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APP_URL = "https://shark.example";

const sessions = vi.hoisted(() => [] as string[]);
const signIns = vi.hoisted(() => [] as string[]);

vi.mock("../auth", () => ({
  auth: {
    handler: async (request: Request) => {
      signIns.push(((await request.json()) as { callbackURL: string }).callbackURL);
      return Response.json({ url: "https://appleid.apple.com/auth/authorize?x=1" });
    },
    api: {
      getSession: async () => null,
      createWebViewSession: async ({ body }: { body: { userId: string } }) => {
        sessions.push(body.userId);
        return {
          headers: new Headers({ "Set-Cookie": "__Secure-better-auth.session_token=synthetic" }),
          response: { ok: true },
        };
      },
    },
  },
}));

let app: typeof import("../app")["app"];
let issueAppPass: typeof import("../lib/app-pass")["issueAppPass"];

const USER = { id: "user_1", name: "Cap", email: "test@example.com" };
const MEMBER = { id: "user_member", name: "Mo", email: "member@example.com" };
const UNCONSENTED = { id: "user_unconsented", name: "Una", email: "unconsented@example.com" };
const OUTSIDER = { id: "user_outsider", name: "Ozzy", email: "outsider@example.com" };
const REMOVED = { id: "user_removed", name: "Rem", email: "removed@example.com" };
const ADDER = { id: "user_adder", name: "Ada", email: "adder@example.com" };
const PEER = { id: "user_peer", name: "Pip", email: "peer@example.com" };
type Person = typeof USER;

let removeMember: typeof import("../lib/teams")["removeMember"];

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ issueAppPass } = await import("../lib/app-pass"));
  ({ removeMember } = await import("../lib/teams"));
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values(
    [USER, MEMBER, UNCONSENTED, OUTSIDER, REMOVED, ADDER, PEER].map((person) => ({
      ...person,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  const base = {
    userId: USER.id,
    shareName: true,
    shareEmail: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.app).values([
    {
      ...base,
      id: "app_board0000",
      name: "Board",
      url: "https://shark.example/board",
      origin: "https://shark.example",
      consentedAt: now,
    },
    {
      ...base,
      id: "app_foreign00",
      name: "Foreign",
      url: "https://other.example/",
      origin: "https://other.example",
      consentedAt: now,
    },
    {
      ...base,
      id: "app_pending00",
      name: "Pending",
      url: "https://shark.example/pending",
      origin: "https://shark.example",
      consentedAt: null,
    },
  ]);

  // A team app on SHark's origin: consent lives in each member's state row.
  await db
    .insert(schema.team)
    .values({ id: "team_1", name: "Crew", createdAt: now, updatedAt: now });
  await db.insert(schema.teamMember).values(
    [USER, MEMBER, UNCONSENTED, REMOVED].map((person) => ({
      teamId: "team_1",
      userId: person.id,
      role: person === USER ? "owner" : "member",
      joinedAt: now,
    })),
  );
  await db.insert(schema.app).values({
    ...base,
    id: "app_teamboard",
    name: "Team board",
    url: "https://shark.example/board?team=1",
    origin: "https://shark.example",
    teamId: "team_1",
    consentedAt: null,
  });
  await db.insert(schema.appMemberState).values([
    { appId: "app_teamboard", userId: USER.id, consentedAt: now, updatedAt: now },
    { appId: "app_teamboard", userId: MEMBER.id, consentedAt: now, updatedAt: now },
    { appId: "app_teamboard", userId: UNCONSENTED.id, consentedAt: null, updatedAt: now },
    { appId: "app_teamboard", userId: REMOVED.id, consentedAt: now, updatedAt: now },
    // Consent left over from before a membership ended must not count.
    { appId: "app_teamboard", userId: OUTSIDER.id, consentedAt: now, updatedAt: now },
  ]);

  // A second team whose app was added by a member who is not the owner.
  await db
    .insert(schema.team)
    .values({ id: "team_2", name: "Deck", createdAt: now, updatedAt: now });
  await db.insert(schema.teamMember).values(
    [USER, ADDER, PEER].map((person) => ({
      teamId: "team_2",
      userId: person.id,
      role: person === USER ? "owner" : "member",
      joinedAt: now,
    })),
  );
  await db.insert(schema.app).values({
    ...base,
    userId: ADDER.id,
    id: "app_addedapp",
    name: "Added",
    url: "https://shark.example/board?team=2",
    origin: "https://shark.example",
    teamId: "team_2",
    consentedAt: null,
  });
  await db.insert(schema.appMemberState).values([
    { appId: "app_addedapp", userId: ADDER.id, consentedAt: now, updatedAt: now },
    { appId: "app_addedapp", userId: PEER.id, consentedAt: now, updatedAt: now },
  ]);

  // A team that team_1's members do not belong to, with stray consent rows.
  await db
    .insert(schema.team)
    .values({ id: "team_3", name: "Rivals", createdAt: now, updatedAt: now });
  await db
    .insert(schema.teamMember)
    .values({ teamId: "team_3", userId: OUTSIDER.id, role: "owner", joinedAt: now });
  await db.insert(schema.app).values({
    ...base,
    userId: OUTSIDER.id,
    id: "app_rivalapp",
    name: "Rival",
    url: "https://shark.example/board?team=3",
    origin: "https://shark.example",
    teamId: "team_3",
    consentedAt: null,
  });
  await db.insert(schema.appMemberState).values([
    { appId: "app_rivalapp", userId: OUTSIDER.id, consentedAt: now, updatedAt: now },
    { appId: "app_rivalapp", userId: MEMBER.id, consentedAt: now, updatedAt: now },
  ]);
});

beforeEach(() => {
  sessions.length = 0;
  signIns.length = 0;
});

const UNSAFE_NEXT = [
  "//evil.example/x",
  "https://evil.example/",
  "/api/board",
  "\\\\evil",
  "/.//evil.example",
  "/..//evil.example",
  "/%2e//evil.example",
  "/%2e%2e//evil.example",
  "/foo/%2e%2e//evil.example",
];

async function pass(
  appId: string,
  origin = "https://shark.example",
  user: Person = USER,
): Promise<string> {
  const issued = await issueAppPass({
    user,
    app: { id: appId, origin, shareName: true, shareEmail: false },
  });
  return issued.token;
}

const teamPass = (user: Person) => pass("app_teamboard", "https://shark.example", user);

async function enter(
  fields: Record<string, string>,
  headers: Record<string, string> = { "x-shark-entry": "1" },
): Promise<Response> {
  return app.request("/apps/enter", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

describe("POST /apps/enter", () => {
  it("trades a first-party pass for a web-view session once", async () => {
    const token = await pass("app_board0000");
    const response = await enter({ pass: token, next: "/board/ask/bask_1" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/board/ask/bask_1");
    expect(response.headers.get("set-cookie")).toContain("session_token=synthetic");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(sessions).toEqual([USER.id]);

    const replay = await enter({ pass: token, next: "/board" });
    expect(replay.status).toBe(401);
    expect(sessions).toHaveLength(1);
  });

  it("refuses passes for other origins, unconsented apps, and junk", async () => {
    for (const token of [
      await pass("app_foreign00", "https://other.example"),
      await pass("app_pending00"),
      await pass("app_missing00"),
      "not-a-pass",
      "",
    ]) {
      expect((await enter({ pass: token })).status).toBe(401);
    }
    expect(sessions).toEqual([]);
  });

  it("never redirects off the site", async () => {
    for (const next of UNSAFE_NEXT) {
      const response = await enter({ pass: await pass("app_board0000"), next });
      expect(response.headers.get("location")).toBe("/dashboard");
    }
  });

  it("refuses cross-site form posts before spending the pass", async () => {
    const token = await pass("app_board0000");
    const crossSite: Array<Record<string, string>> = [
      { origin: "https://evil.example" },
      { origin: "https://evil.example", "x-shark-entry": "1" },
      { "sec-fetch-site": "cross-site", "x-shark-entry": "1" },
      { "sec-fetch-site": "same-site", "x-shark-entry": "1" },
    ];
    for (const headers of crossSite) {
      const response = await enter({ pass: token, next: "/board" }, headers);
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(sessions).toEqual([]);
    const allowed = await enter(
      { pass: token, next: "/board" },
      { "x-shark-entry": "1", origin: "https://shark.example", "sec-fetch-site": "none" },
    );
    expect(allowed.status).toBe(303);
  });

  it("accepts the opaque origin iOS sends for an app-started navigation", async () => {
    const response = await enter(
      { pass: await pass("app_board0000"), next: "/board" },
      { "x-shark-entry": "1", origin: "null", "sec-fetch-site": "none" },
    );
    expect(response.status).toBe(303);
    const forged = await enter(
      { pass: await pass("app_board0000"), next: "/board" },
      { origin: "null" },
    );
    expect(forged.status).toBe(403);
  });
});

describe("POST /apps/enter for a team app", () => {
  it("opens a session for the adder and for a consented member, as themselves", async () => {
    for (const person of [USER, MEMBER]) {
      const response = await enter({ pass: await teamPass(person), next: "/board" });
      expect(response.status).toBe(303);
    }
    expect(sessions).toEqual([USER.id, MEMBER.id]);
  });

  it("refuses a member who has not approved sign-in and a non-member", async () => {
    for (const person of [UNCONSENTED, OUTSIDER]) {
      expect((await enter({ pass: await teamPass(person) })).status).toBe(401);
    }
    expect(sessions).toEqual([]);
  });

  it("refuses a member once they are removed, even with a pass issued before", async () => {
    const issuedWhileMember = await teamPass(REMOVED);
    expect(removeMember("team_1", REMOVED.id)).toBe(true);
    expect((await enter({ pass: issuedWhileMember })).status).toBe(401);
    expect((await enter({ pass: await teamPass(REMOVED) })).status).toBe(401);
    expect(sessions).toEqual([]);
  });

  it("refuses a pass for another team's app, even with consent left over", async () => {
    for (const person of [MEMBER, USER]) {
      const token = await pass("app_rivalapp", "https://shark.example", person);
      expect((await enter({ pass: token })).status).toBe(401);
    }
    expect(sessions).toEqual([]);
  });

  it("refuses a member's pass for another app on the same origin", async () => {
    for (const appId of ["app_board0000", "app_pending00", "app_addedapp"]) {
      const token = await pass(appId, "https://shark.example", MEMBER);
      expect((await enter({ pass: token })).status).toBe(401);
    }
    expect(sessions).toEqual([]);
  });

  it("returns an app to its adder when they leave, refusing everyone else", async () => {
    const { db } = await import("../db");
    const schema = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const added = (user: Person) => pass("app_addedapp", "https://shark.example", user);
    const adderBefore = await added(ADDER);
    const peerBefore = await added(PEER);

    expect(removeMember("team_2", ADDER.id)).toBe(true);
    const [row] = await db
      .select({ teamId: schema.app.teamId })
      .from(schema.app)
      .where(eq(schema.app.id, "app_addedapp"));
    expect(row?.teamId).toBeNull();

    expect((await enter({ pass: peerBefore })).status).toBe(401);
    expect((await enter({ pass: await added(PEER) })).status).toBe(401);
    expect((await enter({ pass: adderBefore, next: "/board" })).status).toBe(303);
    expect((await enter({ pass: await added(ADDER), next: "/board" })).status).toBe(303);
    expect(sessions).toEqual([ADDER.id, ADDER.id]);
  });
});

describe("sign-in return path", () => {
  it("sends a signed-out page visit back to it after sign-in", async () => {
    const page = await app.request("/oss?tab=x", { headers: { accept: "text/html" } });
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login?next=%2Foss%3Ftab%3Dx");
    const login = await app.request("/login?next=%2Fboard%2Fask%2Fbask_1");
    expect(login.status).toBe(302);
    expect(signIns).toEqual(["/board/ask/bask_1"]);
  });

  it("falls back to the dashboard for unsafe targets", async () => {
    for (const next of UNSAFE_NEXT) {
      const response = await app.request(`/login?next=${encodeURIComponent(next)}`);
      expect(response.status).toBe(302);
    }
    await app.request("/login");
    expect(new Set(signIns)).toEqual(new Set(["/dashboard"]));
    expect(signIns).toHaveLength(UNSAFE_NEXT.length + 1);
  });
});
