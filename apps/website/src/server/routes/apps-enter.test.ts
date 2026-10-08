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

beforeAll(async () => {
  ({ app } = await import("../app"));
  ({ issueAppPass } = await import("../lib/app-pass"));
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db
    .insert(schema.user)
    .values({ ...USER, emailVerified: true, createdAt: now, updatedAt: now });
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

async function pass(appId: string, origin = "https://shark.example"): Promise<string> {
  const issued = await issueAppPass({
    user: USER,
    app: { id: appId, origin, shareName: true, shareEmail: false },
  });
  return issued.token;
}

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
