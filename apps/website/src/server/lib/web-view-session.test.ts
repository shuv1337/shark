import { beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APP_URL = "https://shark.example";

let auth: typeof import("../auth")["auth"];

beforeAll(async () => {
  ({ auth } = await import("../auth"));
  const { db } = await import("../db");
  const schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values({
    id: "user_1",
    name: "Cap",
    email: "test@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
});

describe("web-view session endpoint", () => {
  it("opens a browser session Better Auth accepts, as a non-persistent cookie", async () => {
    const { headers } = await auth.api.createWebViewSession({
      body: { userId: "user_1" },
      returnHeaders: true,
    });
    const cookies = headers.getSetCookie();
    const session = cookies.find((cookie) => cookie.includes("session_token="));
    expect(session).toBeDefined();
    expect(session).not.toMatch(/Max-Age|Expires/i);

    const cookieHeader = cookies.map((cookie) => cookie.split(";")[0]).join("; ");
    const current = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader }) });
    expect(current?.user.id).toBe("user_1");
  });

  it("is not reachable over HTTP", async () => {
    const response = await auth.handler(
      new Request("https://shark.example/api/auth/create-web-view-session", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://shark.example" },
        body: JSON.stringify({ userId: "user_1" }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
