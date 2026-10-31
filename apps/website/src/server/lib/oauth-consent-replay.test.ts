import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  guardOAuthConsentReplay,
  releaseConsentSignature,
  reserveConsentSignature,
} from "./oauth-consent-replay";

describe("OAuth consent replay guard", () => {
  it("reserves a signature once and rejects the replay", () => {
    const used = new Map<string, number>();
    const query = "client_id=abc&sig=one&exp=2000000000";
    expect(reserveConsentSignature(used, query, 1_000).status).toBe("reserved");
    expect(reserveConsentSignature(used, query, 1_000).status).toBe("replay");
  });

  it("ignores a body that is not a signed consent request", () => {
    const used = new Map<string, number>();
    expect(reserveConsentSignature(used, undefined).status).toBe("skip");
    expect(reserveConsentSignature(used, "client_id=abc").status).toBe("skip");
    expect(used.size).toBe(0);
  });

  it("releases a reservation when the decision fails", () => {
    const used = new Map<string, number>();
    const first = reserveConsentSignature(used, "sig=one&exp=2000000000", 1_000);
    expect(first.status).toBe("reserved");
    releaseConsentSignature(used, first.signature);
    expect(reserveConsentSignature(used, "sig=one&exp=2000000000", 1_000).status).toBe("reserved");
  });
});

describe("OAuth consent content-type casing", () => {
  const query = "client_id=abc&sig=once&exp=2000000000";

  function consentApp() {
    const used = new Map<string, number>();
    return new Hono()
      .post("/api/auth/oauth2/consent", (c, next) => guardOAuthConsentReplay(c, next, used))
      .post("/api/auth/oauth2/consent", (c) => c.json({ ok: true }));
  }

  async function decide(app: Hono, contentType: string, body: string) {
    return app.request("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
  }

  it.each([
    "Application/JSON",
    "APPLICATION/JSON",
    "application/json; charset=UTF-8",
    "application/vnd.api+json",
  ])("consumes a signature sent as %s so it cannot be reused", async (contentType) => {
    const app = consentApp();
    const body = JSON.stringify({ oauth_query: query });
    const first = await decide(app, contentType, body);
    expect(first.status).toBe(200);
    const replay = await decide(app, "application/json", body);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({
      error: "invalid_request",
      error_description: "This request was already decided",
    });
  });

  it("consumes a signature sent as a mixed-case form body", async () => {
    const app = consentApp();
    const body = new URLSearchParams({ oauth_query: query }).toString();
    const first = await decide(app, "Application/X-WWW-Form-Urlencoded", body);
    expect(first.status).toBe(200);
    const replay = await decide(app, "application/json", JSON.stringify({ oauth_query: query }));
    expect(replay.status).toBe(400);
  });
});
