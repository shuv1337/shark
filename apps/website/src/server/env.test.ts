import { describe, expect, it } from "vitest";
import { assertRuntimeEnv, parseEnv, runtimeEnvIssues } from "./env";

const production = {
  NODE_ENV: "production",
  DEPLOYMENT_MODE: "self_hosted",
  APP_URL: "https://shark.shuv.dev",
  BETTER_AUTH_SECRET: "a-secure-secret-with-enough-entropy",
  ALLOWED_EMAILS: " Operator@Example.com,operator@example.com, relay@privaterelay.appleid.com ",
  APPLE_SIGN_IN_SERVICE_ID: "dev.shuv.shark.web",
  APPLE_SIGN_IN_BUNDLE_ID: "dev.shuv.shark",
  APPLE_SIGN_IN_KEY_ID: "APPLE_KEY",
  APPLE_SIGN_IN_PRIVATE_KEY: "private-key",
  APPLE_TEAM_ID: "TEAM",
  EXPO_ACCESS_TOKEN: "expo-token",
  APNS_KEY_ID: "APNS_KEY",
  APNS_PRIVATE_KEY: "private-key",
  APNS_BUNDLE_ID: "dev.shuv.shark",
  APNS_ENVIRONMENT: "production",
};

describe("SHark runtime environment", () => {
  it("normalizes and deduplicates exact allowed emails", () => {
    const parsed = parseEnv(production);
    expect(parsed.ALLOWED_EMAILS).toEqual([
      "operator@example.com",
      "relay@privaterelay.appleid.com",
    ]);
    expect(runtimeEnvIssues(parsed)).toEqual([]);
  });

  it("uses the frozen self-hosted rate limits", () => {
    const parsed = parseEnv({});
    expect(parsed.SERVICE_RATE_LIMIT_PER_MINUTE).toBe(300);
    expect(parsed.ACCOUNT_RATE_LIMIT_PER_MINUTE).toBe(1500);
  });

  it("treats empty optional Compose values as absent", () => {
    const parsed = parseEnv({ APPLE_TEAM_ID: "  ", AUTUMN_API_KEY: "" });
    expect(parsed.APPLE_TEAM_ID).toBeUndefined();
    expect(parsed.AUTUMN_API_KEY).toBeUndefined();
  });

  it("fails the production credential and admission matrix when incomplete", () => {
    const issues = runtimeEnvIssues(
      parseEnv({
        NODE_ENV: "production",
        APP_URL: "http://localhost:8787",
        BETTER_AUTH_SECRET: "a-secure-secret-with-enough-entropy",
      }),
    );
    expect(issues).toContain("Production requires DEPLOYMENT_MODE=self_hosted.");
    expect(issues).toContain("Production requires at least one ALLOWED_EMAILS address.");
    expect(issues).toContain("Production APP_URL must use HTTPS.");
    expect(issues.some((issue) => issue.startsWith("APPLE_SIGN_IN_SERVICE_ID"))).toBe(true);
    expect(issues).toContain("EXPO_ACCESS_TOKEN is not set.");
    expect(issues).toContain("APNS_KEY_ID / APPLE_TEAM_ID / APNS_PRIVATE_KEY are not all set.");
  });

  it("rejects a non-empty legacy Autumn key", () => {
    const issues = runtimeEnvIssues(parseEnv({ AUTUMN_API_KEY: "legacy-key" }));
    expect(issues).toContain("AUTUMN_API_KEY must be unset; SHark has no billing runtime.");
  });

  it("rejects partially configured credential groups in development", () => {
    expect(() => assertRuntimeEnv(parseEnv({ APPLE_TEAM_ID: "TEAM" }))).toThrow(
      "Partially configured Sign in with Apple credential group.",
    );
    expect(() =>
      assertRuntimeEnv(
        parseEnv({
          APPLE_SIGN_IN_SERVICE_ID: "dev.shuv.shark.web",
          APPLE_SIGN_IN_KEY_ID: "APPLE_KEY",
          APPLE_SIGN_IN_PRIVATE_KEY: "private-key",
          APNS_KEY_ID: "APNS_KEY",
          APPLE_TEAM_ID: "TEAM",
        }),
      ),
    ).toThrow("Partially configured APNs credential group.");
  });
});
