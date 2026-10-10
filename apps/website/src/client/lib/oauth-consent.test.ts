import { OAUTH_API_SCOPES, OAUTH_DEFAULT_SCOPES } from "@hark/contracts";
import { describe, expect, it } from "vitest";
import {
  canApproveConsent,
  consentedScopes,
  initialConsentSelection,
  isHighImpactScope,
} from "./oauth-consent";

describe("OAuth consent selection", () => {
  it("leaves high-impact scopes unticked for a default request", () => {
    const requested = OAUTH_API_SCOPES.filter((scope) => OAUTH_DEFAULT_SCOPES.includes(scope));
    const selected = initialConsentSelection(requested);
    for (const scope of ["oncall:write", "teams:write", "services:write", "devices:write"]) {
      expect(isHighImpactScope(scope)).toBe(true);
      expect([...selected]).not.toContain(scope);
    }
    expect(selected.has("notifications:send")).toBe(true);
    expect(selected.has("interactions:create")).toBe(true);
    expect(selected.has("teams:read")).toBe(true);
  });

  it("still grants a high-impact scope the person ticks", () => {
    const selected = initialConsentSelection(["notifications:send", "oncall:write"]);
    expect(consentedScopes(selected, false)).toEqual(["notifications:send"]);
    selected.add("oncall:write");
    expect(consentedScopes(selected, true)).toEqual([
      "notifications:send",
      "oncall:write",
      "offline_access",
    ]);
  });

  it("approves an offline_access-only request", () => {
    expect(consentedScopes(initialConsentSelection([]), true)).toEqual(["offline_access"]);
    expect(consentedScopes(new Set(), false)).toEqual([]);
  });

  it("needs a ticked API scope when the request names any", () => {
    const requested = ["services:write", "oncall:write"] as const;
    const selected = initialConsentSelection(requested);
    expect(selected.size).toBe(0);
    expect(canApproveConsent(requested, selected, true)).toBe(false);
    selected.add("oncall:write");
    expect(canApproveConsent(requested, selected, true)).toBe(true);
    expect(canApproveConsent(requested, selected, false)).toBe(true);
  });

  it("allows approving an offline_access-only request only while it is ticked", () => {
    expect(canApproveConsent([], new Set(), true)).toBe(true);
    expect(canApproveConsent([], new Set(), false)).toBe(false);
  });

  it("orders granted scopes canonically", () => {
    expect(consentedScopes(new Set([...OAUTH_API_SCOPES].reverse()), false)).toEqual([
      ...OAUTH_API_SCOPES,
    ]);
  });
});
