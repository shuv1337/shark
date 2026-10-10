import type {
  AppDto,
  AppPassClaims,
  AppPassResponse,
  InboxNotificationPageDto,
  TeamDto,
  TeamInviteCreateResponse,
  TeamInvitePreviewDto,
  TeamJoinResponse,
  TeamMemberDto,
} from "@hark/contracts";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const authState = vi.hoisted(() => ({ userId: "user_a" as string | null }));
const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);

const NAMES: Record<string, string> = { user_a: "Ryan", user_b: "Bea", user_c: "Cam" };

vi.mock("../auth", () => ({
  auth: {
    handler: () => new Response("not used"),
    api: {
      getSession: async () =>
        authState.userId
          ? {
              user: {
                id: authState.userId,
                name: NAMES[authState.userId] ?? authState.userId,
                email: `${authState.userId}@example.com`,
                image: null,
              },
            }
          : null,
    },
  },
}));

vi.mock("expo-server-sdk", () => {
  class Expo {
    chunkPushNotifications(messages: Array<Record<string, unknown>>) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages: Array<Record<string, unknown>>) {
      sent.push(...messages);
      return messages.map(() => ({ status: "ok", id: "ticket" }));
    }
  }
  return { Expo, default: Expo };
});

let app: typeof import("../app")["app"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

const TEAMS_TOKEN = `hark_${"t".repeat(43)}`;
const NO_TEAMS_TOKEN = `hark_${"u".repeat(43)}`;
const APPS_ONLY_TOKEN = `hark_${"v".repeat(43)}`;
const BEA_APPS_TOKEN = `hark_${"w".repeat(43)}`;

function as(userId: string | null) {
  authState.userId = userId;
}

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** Lets fire-and-forget notices finish before asserting on pushes. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function claimsOf(token: string): AppPassClaims {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as AppPassClaims;
}

afterEach(() => {
  sent.length = 0;
  as("user_a");
});

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  const { hashApiToken } = await import("../lib/token");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values(
    Object.entries(NAMES).map(([id, name]) => ({
      id,
      name,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  await db.insert(schema.device).values(
    Object.keys(NAMES).map((id) => ({
      id: `dev_${id}`,
      userId: id,
      expoPushToken: `ExponentPushToken[${id}]`,
      createdAt: now,
      lastSeenAt: now,
    })),
  );
  await db.insert(schema.apiToken).values([
    {
      id: "tok_teams",
      userId: "user_a",
      name: "Team bot",
      tokenHash: hashApiToken(TEAMS_TOKEN),
      prefix: "hark_ttttttt",
      scopes: ["teams:read", "teams:write", "apps:read", "apps:write"],
      createdAt: now,
    },
    {
      id: "tok_noteams",
      userId: "user_a",
      name: "Narrow bot",
      tokenHash: hashApiToken(NO_TEAMS_TOKEN),
      prefix: "hark_uuuuuuu",
      scopes: ["apps:read"],
      createdAt: now,
    },
    {
      id: "tok_appsonly",
      userId: "user_a",
      name: "Apps bot",
      tokenHash: hashApiToken(APPS_ONLY_TOKEN),
      prefix: "hark_vvvvvvv",
      scopes: ["apps:read", "apps:write"],
      createdAt: now,
    },
    {
      id: "tok_bea_apps",
      userId: "user_b",
      name: "Bea apps bot",
      tokenHash: hashApiToken(BEA_APPS_TOKEN),
      prefix: "hark_wwwwwww",
      scopes: ["apps:read", "apps:write"],
      createdAt: now,
    },
  ]);
});

async function createTeam(name: string): Promise<TeamDto> {
  const response = await call("POST", "/api/teams", { name });
  expect(response.status).toBe(201);
  return ((await response.json()) as { team: TeamDto }).team;
}

async function invite(teamId: string, body: unknown = {}): Promise<TeamInviteCreateResponse> {
  const response = await call("POST", `/api/teams/${teamId}/invites`, body);
  expect(response.status).toBe(201);
  return (await response.json()) as TeamInviteCreateResponse;
}

async function join(userId: string, code: string): Promise<TeamJoinResponse> {
  as(userId);
  const response = await call("POST", `/api/team-invites/${code}/accept`);
  expect(response.status).toBe(200);
  return (await response.json()) as TeamJoinResponse;
}

describe("teams and invites", () => {
  it("creates a team owned by its creator and lets an invitee join through the link", async () => {
    const team = await createTeam("Acme");
    expect(team).toMatchObject({ name: "Acme", role: "owner", memberCount: 1, plan: "free" });
    expect(team.id).toMatch(/^team_/);

    const created = await invite(team.id);
    expect(created.url).toBe(`http://localhost:5173/join/${created.code}`);
    expect(created.invite).toMatchObject({ role: "member", invitedBy: "Ryan", acceptedAt: null });

    // The join pages only open signed in, so the preview needs a session too.
    as(null);
    expect((await call("GET", `/api/team-invites/${created.code}`)).status).toBe(401);
    as("user_c");
    const preview = await call("GET", `/api/team-invites/${created.code}`);
    expect(preview.status).toBe(200);
    expect((await preview.json()) as TeamInvitePreviewDto).toMatchObject({
      teamName: "Acme",
      invitedBy: "Ryan",
      role: "member",
      memberCount: 1,
    });
    // Accepting is a human decision: no session, no join.
    as(null);
    expect((await call("POST", `/api/team-invites/${created.code}/accept`)).status).toBe(401);

    const joined = await join("user_b", created.code);
    expect(joined.joined).toBe(true);
    expect(joined.team).toMatchObject({ id: team.id, role: "member", memberCount: 2 });

    // Single use: the code is spent.
    as("user_c");
    expect((await call("GET", `/api/team-invites/${created.code}`)).status).toBe(404);
    as("user_b");
    const listed = (await (await call("GET", "/api/teams")).json()) as { teams: TeamDto[] };
    expect(listed.teams.map((entry) => [entry.name, entry.role])).toEqual([["Acme", "member"]]);
  });

  it("refuses cookie mutations from another origin but allows the site and the native app", async () => {
    const team = await createTeam("Origins");
    const created = await invite(team.id);
    const from = (method: string, path: string, origin?: string) =>
      app.request(path, {
        method,
        headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
        ...(method === "GET" ? {} : { body: "{}" }),
      });
    const foreign = "https://evil.example";
    as("user_b");
    for (const [method, path] of [
      ["POST", "/api/teams"],
      ["PATCH", `/api/teams/${team.id}`],
      ["DELETE", `/api/teams/${team.id}`],
      ["POST", `/api/teams/${team.id}/invites`],
      ["POST", `/api/team-invites/${created.code}/accept`],
      ["POST", "/api/oncall/ocg_synthetic/pages"],
      ["POST", "/api/pages/page_synthetic/acknowledge"],
    ] as const) {
      expect((await from(method, path, foreign)).status, `${method} ${path}`).toBe(403);
      expect((await from(method, path, "null")).status, `${method} ${path}`).toBe(403);
    }
    expect((await from("GET", `/api/team-invites/${created.code}`, foreign)).status).toBe(200);
    expect((await from("GET", "/api/teams", foreign)).status).toBe(200);

    // The dashboard sends its own origin; the iPhone app sends none.
    const site = new URL(created.url).origin;
    const accepted = await from("POST", `/api/team-invites/${created.code}/accept`, site);
    expect(accepted.status).toBe(200);
    as("user_c");
    expect((await from("POST", `/api/teams/${team.id}/leave`)).status).toBe(404);
  });

  it("refuses cross-origin simple forms and method-override headers", async () => {
    const team = await createTeam("Form origins");
    as("user_b");
    const foreign = "https://evil.example";
    const forms: Array<[string, BodyInit]> = [
      ["application/x-www-form-urlencoded", "name=Hijacked"],
      ["multipart/form-data; boundary=synthetic", "--synthetic--\r\n"],
      ["text/plain", '{"name":"Hijacked"}'],
    ];
    for (const [type, body] of forms) {
      for (const path of ["/api/teams", `/api/teams/${team.id}/leave`]) {
        const response = await app.request(path, {
          method: "POST",
          headers: { "content-type": type, origin: foreign },
          body,
        });
        expect(response.status, `${type} ${path}`).toBe(403);
      }
    }
    for (const override of ["GET", "HEAD"]) {
      for (const header of ["x-http-method-override", "x-http-method", "x-method-override"]) {
        const response = await app.request(`/api/teams/${team.id}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: foreign, [header]: override },
          body: "{}",
        });
        expect(response.status, `${header}: ${override}`).toBe(403);
      }
    }
    as("user_a");
    const unchanged = (await (await call("GET", `/api/teams/${team.id}`)).json()) as {
      team: { name: string };
    };
    expect(unchanged.team.name).toBe("Form origins");
  });

  it("keeps every team on the free plan with unlimited seats and no billing", async () => {
    const team = await createTeam("Unbilled");
    expect(team).toMatchObject({ plan: "free", seats: { used: 1, available: null, billable: 0 } });
    await join("user_b", (await invite(team.id)).code);
    as("user_a");
    await join("user_c", (await invite(team.id)).code);

    as("user_a");
    const detail = (await (await call("GET", `/api/teams/${team.id}`)).json()) as {
      team: TeamDto;
    };
    expect(detail.team).toMatchObject({
      plan: "free",
      memberCount: 3,
      seats: { used: 3, available: null, billable: 0 },
    });
    for (const kind of ["checkout", "portal"]) {
      const response = await call("POST", `/api/teams/${team.id}/billing/${kind}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });

  it("pushes an invite to an existing user with that email and files it in their inbox", async () => {
    const team = await createTeam("Pushed");
    const created = await invite(team.id, { email: "USER_C@example.com" });
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_c]",
      title: "Ryan invited you to Pushed",
      data: { url: `shark://join/${created.code}` },
    });
    as("user_c");
    const inbox = (await (
      await call("GET", "/api/inbox/notifications")
    ).json()) as InboxNotificationPageDto;
    expect(inbox.items[0]).toMatchObject({
      title: "Ryan invited you to Pushed",
      sourceName: "SHark Teams",
      url: `shark://join/${created.code}`,
    });
  });

  it("lets only the invited account accept an invite addressed to an email", async () => {
    const team = await createTeam("Addressed");
    const created = await invite(team.id, { email: "User_C@Example.com" });
    expect(created.invite.email).toBe("user_c@example.com");

    as("user_b");
    const wrong = await call("POST", `/api/team-invites/${created.code}/accept`);
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ error: "This invite is for a different account" });
    // The refusal does not spend the invite.
    expect((await call("GET", `/api/team-invites/${created.code}`)).status).toBe(200);

    const joined = await join("user_c", created.code);
    expect(joined).toMatchObject({ joined: true, team: { id: team.id, memberCount: 2 } });
  });

  it("enforces roles and transfers ownership", async () => {
    const team = await createTeam("Roles");
    await join("user_b", (await invite(team.id)).code);

    as("user_b");
    expect((await call("PATCH", `/api/teams/${team.id}`, { name: "Mine" })).status).toBe(403);
    expect((await call("POST", `/api/teams/${team.id}/invites`, {})).status).toBe(403);
    expect((await call("DELETE", `/api/teams/${team.id}`)).status).toBe(403);

    as("user_a");
    expect((await call("POST", `/api/teams/${team.id}/leave`)).status).toBe(409);
    const promoted = await call("PATCH", `/api/teams/${team.id}/members/user_b`, { role: "admin" });
    expect(((await promoted.json()) as { member: TeamMemberDto }).member.role).toBe("admin");

    as("user_b");
    // Admins cannot hand out ownership or remove the owner.
    expect(
      (await call("PATCH", `/api/teams/${team.id}/members/user_b`, { role: "owner" })).status,
    ).toBe(403);
    expect((await call("DELETE", `/api/teams/${team.id}/members/user_a`)).status).toBe(409);
    const renamed = await call("PATCH", `/api/teams/${team.id}`, { name: "Roles 2" });
    expect(((await renamed.json()) as { team: TeamDto }).team.name).toBe("Roles 2");

    as("user_a");
    const transfer = await call("PATCH", `/api/teams/${team.id}/members/user_b`, { role: "owner" });
    expect(transfer.status).toBe(200);
    const detail = (await (await call("GET", `/api/teams/${team.id}`)).json()) as {
      team: TeamDto;
      members: TeamMemberDto[];
    };
    expect(detail.team.role).toBe("admin");
    expect(detail.members.map((member) => [member.userId, member.role])).toEqual([
      ["user_b", "owner"],
      ["user_a", "admin"],
    ]);
    expect((await call("POST", `/api/teams/${team.id}/leave`)).status).toBe(200);
    expect((await call("GET", `/api/teams/${team.id}`)).status).toBe(404);
  });

  it("revokes invites", async () => {
    const team = await createTeam("Revoke");
    const created = await invite(team.id);
    expect(
      (await call("DELETE", `/api/teams/${team.id}/invites/${created.invite.id}`)).status,
    ).toBe(200);
    const list = (await (await call("GET", `/api/teams/${team.id}/invites`)).json()) as {
      invites: Array<{ revokedAt: string | null }>;
    };
    expect(list.invites[0]?.revokedAt).not.toBeNull();
    as("user_b");
    expect((await call("POST", `/api/team-invites/${created.code}/accept`)).status).toBe(404);
  });
});

describe("team apps", () => {
  it("shares an app, lets every member approve sign-in, and blocks removed members", async () => {
    const team = await createTeam("Apps");
    await join("user_b", (await invite(team.id)).code);
    as("user_a");
    const now = new Date();
    await db.insert(schema.app).values({
      id: "app_shared_0001",
      userId: "user_a",
      name: "Ops",
      url: "https://ops.example.com/",
      origin: "https://ops.example.com",
      consentedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    sent.length = 0;

    as("user_b");
    expect(
      (await call("POST", "/api/apps/app_shared_0001/share", { teamId: team.id })).status,
    ).toBe(404);

    as("user_a");
    const shared = await call("POST", "/api/apps/app_shared_0001/share", { teamId: team.id });
    expect(shared.status).toBe(200);
    const sharedApp = ((await shared.json()) as { app: AppDto }).app;
    expect(sharedApp.team).toEqual({ id: team.id, name: "Apps" });
    // The adder keeps their earlier approval.
    expect(sharedApp.consentedAt).not.toBeNull();
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: "ExponentPushToken[user_b]",
      title: "Ryan added Ops to Apps",
      data: { appId: "app_shared_0001" },
    });

    as("user_b");
    const apps = ((await (await call("GET", "/api/apps")).json()) as { apps: AppDto[] }).apps;
    expect(apps.map((entry) => [entry.id, entry.addedBy, entry.consentedAt])).toEqual([
      ["app_shared_0001", "Ryan", null],
    ]);
    const blocked = await call("POST", "/api/apps/app_shared_0001/pass", {});
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "consent_required" });
    const pass = await call("POST", "/api/apps/app_shared_0001/pass", {
      consent: true,
      shareEmail: true,
    });
    expect(pass.status).toBe(200);
    const body = (await pass.json()) as AppPassResponse;
    expect(claimsOf(body.token)).toMatchObject({
      app_id: "app_shared_0001",
      team_id: team.id,
      team_role: "member",
      email: "user_b@example.com",
      name: "Bea",
    });
    // Members cannot remove an app someone else added.
    expect((await call("DELETE", "/api/apps/app_shared_0001")).status).toBe(403);

    as("user_a");
    const ownerPass = (await (
      await call("POST", "/api/apps/app_shared_0001/pass", {})
    ).json()) as AppPassResponse;
    expect(claimsOf(ownerPass.token)).toMatchObject({ team_role: "owner" });
    expect(claimsOf(ownerPass.token).email).toBeUndefined();

    expect((await call("DELETE", `/api/teams/${team.id}/members/user_b`)).status).toBe(200);
    as("user_b");
    expect((await call("POST", "/api/apps/app_shared_0001/pass", {})).status).toBe(404);
    expect(((await (await call("GET", "/api/apps")).json()) as { apps: AppDto[] }).apps).toEqual(
      [],
    );

    // Deleting the team returns the app to the person who added it.
    as("user_a");
    expect((await call("DELETE", `/api/teams/${team.id}`)).status).toBe(200);
    const returned = (
      (await (await call("GET", "/api/apps/app_shared_0001")).json()) as { app: AppDto }
    ).app;
    expect(returned.team).toBeNull();
    expect(returned.consentedAt).not.toBeNull();
  });

  it("refuses a pass and writes no member state when removal lands mid-request", async () => {
    const team = await createTeam("Mid-pass removal");
    await join("user_b", (await invite(team.id)).code);
    const now = new Date();
    await db.insert(schema.app).values({
      id: "app_midpass_001",
      userId: "user_a",
      teamId: team.id,
      name: "Ops",
      url: "https://midpass.example.com/",
      origin: "https://midpass.example.com",
      createdAt: now,
      updatedAt: now,
    });
    // Remove Bea once the route has passed its access check and reads her app state.
    const select = db.select.bind(db);
    let armed = true;
    const spy = vi.spyOn(db, "select").mockImplementation(((...args: Parameters<typeof select>) => {
      const builder = select(...args);
      const from = builder.from.bind(builder);
      builder.from = ((table: Parameters<typeof from>[0]) => {
        if (armed && table === schema.appMemberState) {
          armed = false;
          db.delete(schema.teamMember)
            .where(
              and(eq(schema.teamMember.teamId, team.id), eq(schema.teamMember.userId, "user_b")),
            )
            .run();
        }
        return from(table);
      }) as typeof from;
      return builder;
    }) as typeof db.select);
    try {
      as("user_b");
      const pass = await call("POST", "/api/apps/app_midpass_001/pass", { consent: true });
      expect(armed).toBe(false);
      expect(pass.status).toBe(404);
    } finally {
      spy.mockRestore();
    }
    expect(
      await db
        .select()
        .from(schema.appMemberState)
        .where(eq(schema.appMemberState.appId, "app_midpass_001")),
    ).toEqual([]);
  });

  it("gives a leaving member back the apps they added, with their own sign-in state", async () => {
    const team = await createTeam("Leavers");
    await join("user_b", (await invite(team.id)).code);
    const now = new Date();
    await db.insert(schema.app).values({
      id: "app_leaver_0001",
      userId: "user_b",
      teamId: team.id,
      name: "Bea's tool",
      url: "https://bea-tool.example.com/",
      origin: "https://bea-tool.example.com",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.appMemberState).values([
      {
        appId: "app_leaver_0001",
        userId: "user_b",
        shareEmail: true,
        consentedAt: now,
        updatedAt: now,
      },
      { appId: "app_leaver_0001", userId: "user_a", consentedAt: now, updatedAt: now },
    ]);

    as("user_b");
    expect((await call("POST", `/api/teams/${team.id}/leave`)).status).toBe(200);
    const returned = (
      (await (await call("GET", "/api/apps/app_leaver_0001")).json()) as { app: AppDto }
    ).app;
    expect(returned).toMatchObject({ team: null, shareEmail: true });
    expect(returned.consentedAt).not.toBeNull();

    as("user_a");
    expect((await call("GET", "/api/apps/app_leaver_0001")).status).toBe(404);
    const teamApps = (await (await call("GET", `/api/teams/${team.id}/apps`)).json()) as {
      apps: AppDto[];
    };
    expect(teamApps.apps).toEqual([]);
    const leftover = await db
      .select()
      .from(schema.appMemberState)
      .where(eq(schema.appMemberState.appId, "app_leaver_0001"));
    expect(leftover).toEqual([]);
  });

  it("shows the registering token's name only to the member who added the app", async () => {
    const team = await createTeam("Token names");
    await join("user_b", (await invite(team.id)).code);
    const created = await call(
      "POST",
      "/api/agent/apps",
      { name: "Metrics", url: "https://metrics.example.com/", teamId: team.id },
      TEAMS_TOKEN,
    );
    expect(created.status).toBe(201);
    const { app: createdApp } = (await created.json()) as { app: AppDto };
    expect(createdApp.createdBy).toBe("Team bot");

    as("user_a");
    expect(
      ((await (await call("GET", `/api/apps/${createdApp.id}`)).json()) as { app: AppDto }).app
        .createdBy,
    ).toBe("Team bot");
    as("user_b");
    const asMember = (
      (await (await call("GET", `/api/apps/${createdApp.id}`)).json()) as { app: AppDto }
    ).app;
    expect(asMember.createdBy).toBeNull();
    const listed = (await (await call("GET", `/api/teams/${team.id}/apps`)).json()) as {
      apps: AppDto[];
    };
    expect(listed.apps.map((entry) => entry.createdBy)).toEqual([null]);
  });

  it("lets agents create team apps and list teams, scope-checked", async () => {
    const team = await createTeam("Agents");
    const listed = await call("GET", "/api/agent/teams", undefined, TEAMS_TOKEN);
    expect(listed.status).toBe(200);
    expect(
      ((await listed.json()) as { teams: TeamDto[] }).teams.some((entry) => entry.id === team.id),
    ).toBe(true);
    expect((await call("GET", "/api/agent/teams", undefined, NO_TEAMS_TOKEN)).status).toBe(403);

    const created = await call(
      "POST",
      "/api/agent/apps",
      { name: "Grafana", url: "https://grafana.example.com/", teamId: team.id },
      TEAMS_TOKEN,
    );
    expect(created.status).toBe(201);
    const createdApp = ((await created.json()) as { app: AppDto }).app;
    expect(createdApp.team?.id).toBe(team.id);

    const teamApps = await call("GET", `/api/agent/teams/${team.id}/apps`, undefined, TEAMS_TOKEN);
    expect(((await teamApps.json()) as { apps: AppDto[] }).apps.map((entry) => entry.id)).toEqual([
      createdApp.id,
    ]);
    const unshared = await call(
      "POST",
      `/api/agent/apps/${createdApp.id}/share`,
      { teamId: null },
      TEAMS_TOKEN,
    );
    expect(((await unshared.json()) as { app: AppDto }).app.team).toBeNull();

    const agentInvite = await call("POST", `/api/agent/teams/${team.id}/invites`, {}, TEAMS_TOKEN);
    expect(agentInvite.status).toBe(201);
    // There is no agent route that accepts an invite.
    const { code } = (await agentInvite.json()) as TeamInviteCreateResponse;
    expect(
      (await call("POST", `/api/agent/team-invites/${code}/accept`, undefined, TEAMS_TOKEN)).status,
    ).toBe(404);
  });

  it("requires teams:write before an agent can share an app or create one in a team", async () => {
    const team = await createTeam("Scoped");
    const { code } = await invite(team.id);
    await join("user_b", code);
    as("user_a");
    sent.length = 0;

    const createdInTeam = await call(
      "POST",
      "/api/agent/apps",
      { name: "Docs", url: "https://docs.example.com/", teamId: team.id },
      APPS_ONLY_TOKEN,
    );
    expect(createdInTeam.status).toBe(403);
    expect(await createdInTeam.json()).toMatchObject({ required: ["teams:write"] });

    const personal = await call(
      "POST",
      "/api/agent/apps",
      { name: "Docs", url: "https://docs.example.com/" },
      APPS_ONLY_TOKEN,
    );
    expect(personal.status).toBe(201);
    const { app: personalApp } = (await personal.json()) as { app: AppDto };
    const shared = await call(
      "POST",
      `/api/agent/apps/${personalApp.id}/share`,
      { teamId: team.id },
      APPS_ONLY_TOKEN,
    );
    expect(shared.status).toBe(403);
    expect(await shared.json()).toMatchObject({ required: ["apps:write", "teams:write"] });
    await settle();
    expect(sent).toHaveLength(0);
  });

  it("lets only the adder or a team admin rename a team app by re-registering its URL", async () => {
    const { hashApiToken } = await import("../lib/token");
    const team = await createTeam("Re-register");
    await join("user_b", (await invite(team.id)).code);
    as("user_a");
    const body = { name: "Status", url: "https://status.example.com/", teamId: team.id };
    const created = await call("POST", "/api/agent/apps", body, TEAMS_TOKEN);
    expect(created.status).toBe(201);
    const { app: teamApp } = (await created.json()) as { app: AppDto };
    const memberToken = `hark_${"x".repeat(43)}`;
    await db.insert(schema.apiToken).values({
      id: "tok_bea_teams",
      userId: "user_b",
      name: "Bea teams bot",
      tokenHash: hashApiToken(memberToken),
      prefix: "hark_xxxxxxx",
      scopes: ["apps:read", "apps:write", "teams:read", "teams:write"],
      createdAt: new Date(),
    });

    const renamed = await call(
      "POST",
      "/api/agent/apps",
      { ...body, name: "Hijacked" },
      memberToken,
    );
    expect(renamed.status).toBe(403);
    await db
      .update(schema.teamMember)
      .set({ role: "admin" })
      .where(and(eq(schema.teamMember.teamId, team.id), eq(schema.teamMember.userId, "user_b")));
    const byAdmin = await call(
      "POST",
      "/api/agent/apps",
      { ...body, name: "Status (admin)" },
      memberToken,
    );
    expect(byAdmin.status).toBe(200);
    expect(((await byAdmin.json()) as { app: AppDto }).app).toMatchObject({
      id: teamApp.id,
      name: "Status (admin)",
    });
    const again = await call(
      "POST",
      "/api/agent/apps",
      { ...body, name: "Status v2" },
      TEAMS_TOKEN,
    );
    expect(again.status).toBe(200);
    expect(((await again.json()) as { app: AppDto }).app).toMatchObject({
      id: teamApp.id,
      name: "Status v2",
    });
  });

  it("lets an apps:write token move its owner's app back out of a team without teams:write", async () => {
    const team = await createTeam("Unshare");
    await join("user_b", (await invite(team.id)).code);
    as("user_a");
    const created = await call(
      "POST",
      "/api/agent/apps",
      { name: "Wiki", url: "https://wiki.example.com/", teamId: team.id },
      TEAMS_TOKEN,
    );
    const { app: teamApp } = (await created.json()) as { app: AppDto };
    await settle();
    sent.length = 0;

    const readOnly = await call(
      "POST",
      `/api/agent/apps/${teamApp.id}/share`,
      { teamId: null },
      NO_TEAMS_TOKEN,
    );
    expect(readOnly.status).toBe(403);
    expect(await readOnly.json()).toMatchObject({ required: ["apps:write"] });

    // Ownership still applies: a member cannot pull someone else's app out.
    const notOwner = await call(
      "POST",
      `/api/agent/apps/${teamApp.id}/share`,
      { teamId: null },
      BEA_APPS_TOKEN,
    );
    expect(notOwner.status).toBe(403);

    const unshared = await call(
      "POST",
      `/api/agent/apps/${teamApp.id}/share`,
      { teamId: null },
      APPS_ONLY_TOKEN,
    );
    expect(unshared.status).toBe(200);
    expect(((await unshared.json()) as { app: AppDto }).app.team).toBeNull();
    await settle();
    expect(sent).toHaveLength(0);

    // Malformed bodies are not treated as an un-share.
    const malformed = await call(
      "POST",
      `/api/agent/apps/${teamApp.id}/share`,
      { teamId: null, extra: true },
      APPS_ONLY_TOKEN,
    );
    expect(malformed.status).toBe(403);
  });

  it("caps how many notices one sender can push per minute", async () => {
    const { NOTICES_PER_SENDER_PER_MINUTE, sendNotice } = await import("../lib/teams");
    const notice = {
      senderUserId: "user_flood_sender",
      title: "Synthetic notice",
      body: "Synthetic body",
      sourceName: "Test",
      conversationKey: "team-flood",
    };
    const results: number[] = [];
    for (let index = 0; index < NOTICES_PER_SENDER_PER_MINUTE + 2; index += 1) {
      results.push(await sendNotice(["user_c"], notice));
    }
    expect(results.filter((accepted) => accepted > 0)).toHaveLength(NOTICES_PER_SENDER_PER_MINUTE);
    expect(results.slice(-2)).toEqual([0, 0]);
    expect(sent.filter((message) => message.to === "ExponentPushToken[user_c]")).toHaveLength(
      NOTICES_PER_SENDER_PER_MINUTE,
    );
    expect(await sendNotice(["user_c"], { ...notice, senderUserId: "user_other_sender" })).toBe(1);
  });
});
