import { describe, expect, it, vi } from "vitest";
import { beginAppleWebSignIn } from "./web-sign-in";

describe("Apple web sign-in bootstrap", () => {
  it("returns an empty redirect while preserving Better Auth state cookies", async () => {
    const handler = vi.fn(
      async (_request: Request): Promise<Response> =>
        Response.json(
          {
            url: "https://appleid.apple.com/auth/authorize?client_id=dev.shuv.shark.web",
            redirect: true,
          },
          { headers: { "Set-Cookie": "better-auth.state=opaque; HttpOnly; Secure" } },
        ),
    );

    const response = await beginAppleWebSignIn(handler, "https://shark.shuv.dev");

    expect(handler).toHaveBeenCalledOnce();
    const request = handler.mock.calls[0]?.[0];
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("origin")).toBe("https://shark.shuv.dev");
    expect(await request?.json()).toEqual({
      provider: "apple",
      callbackURL: "/dashboard",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("https://appleid.apple.com/auth/authorize");
    expect(response.headers.get("set-cookie")).toContain("better-auth.state=opaque");
    expect(await response.text()).toBe("");
  });

  it("fails closed without anonymous content for invalid provider responses", async () => {
    for (const providerResponse of [
      Response.json({ url: "https://example.com/phish" }),
      Response.json({ redirect: true }),
      Response.json({ error: "unavailable" }, { status: 500 }),
    ]) {
      const response = await beginAppleWebSignIn(
        async () => providerResponse.clone(),
        "https://shark.shuv.dev",
      );
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("");
    }
  });
});
