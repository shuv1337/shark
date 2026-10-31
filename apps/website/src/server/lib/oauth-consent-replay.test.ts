import { describe, expect, it } from "vitest";
import { releaseConsentSignature, reserveConsentSignature } from "./oauth-consent-replay";

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
