import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accessLog, redactedRequestPath } from "./access-log";

const INVITE_CODE = "synthetic_invite_code_0123456789abcdef";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("access log redaction", () => {
  it("replaces credential path segments and keeps the route shape", () => {
    expect(redactedRequestPath("/hooks/whk_synthetic")).toBe("/hooks/:token");
    expect(redactedRequestPath("/conversation/v1/ref_synthetic")).toBe(
      "/conversation/v1/:reference",
    );
    expect(redactedRequestPath(`/join/${INVITE_CODE}`)).toBe("/join/:code");
    expect(redactedRequestPath(`/api/team-invites/${INVITE_CODE}`)).toBe("/api/team-invites/:code");
    expect(redactedRequestPath(`/api/team-invites/${INVITE_CODE}/accept`)).toBe(
      "/api/team-invites/:code/accept",
    );
    expect(redactedRequestPath("/api/teams/team_1/invites")).toBe("/api/teams/team_1/invites");
  });

  it("never writes an invite code to the log sink", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const app = new Hono()
      .use("*", accessLog)
      .get("/join/:code", (c) => c.text("ok"))
      .get("/api/team-invites/:code", (c) => c.json({}))
      .post("/api/team-invites/:code/accept", (c) => c.json({}));

    await app.request(`/join/${INVITE_CODE}`);
    await app.request(`/api/team-invites/${INVITE_CODE}`);
    await app.request(`/api/team-invites/${INVITE_CODE}/accept`, { method: "POST" });

    expect(lines).toHaveLength(3);
    expect(lines.join("\n")).not.toContain(INVITE_CODE);
    expect(lines[0]).toMatch(/^GET \/join\/:code 200 \d+ms$/);
    expect(lines[2]).toMatch(/^POST \/api\/team-invites\/:code\/accept 200 \d+ms$/);
  });
});
