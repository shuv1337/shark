import { getTestInstance } from "better-auth/test";
import { afterEach, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";

const originalAllowedEmails = process.env.ALLOWED_EMAILS;

afterEach(async () => {
  const { env } = await import("../env");
  env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length);
  if (originalAllowedEmails === undefined) {
    delete process.env.ALLOWED_EMAILS;
  } else {
    process.env.ALLOWED_EMAILS = originalAllowedEmails;
  }
});

async function appleProviderHarness(email: string, allowedEmails: string[]) {
  const { auth: applicationAuth } = await import("../auth");
  const { env } = await import("../env");
  env.ALLOWED_EMAILS.splice(0, env.ALLOWED_EMAILS.length, ...allowedEmails);

  return getTestInstance(
    {
      databaseHooks: applicationAuth.options.databaseHooks,
      socialProviders: {
        apple: {
          clientId: "dev.shuv.shark.web",
          clientSecret: "test-apple-secret",
          verifyIdToken: async () => true,
          getUserInfo: async () => ({
            user: {
              id: "stable-apple-subject",
              name: "Operator",
              email,
              emailVerified: true,
            },
            data: {},
          }),
        },
      },
    },
    { disableTestUser: true },
  );
}

async function signInWithAppleIdToken(instance: Awaited<ReturnType<typeof appleProviderHarness>>) {
  return instance.auth.api.signInSocial({
    body: {
      provider: "apple",
      callbackURL: "/dashboard",
      idToken: { token: "opaque-test-token" },
    },
    headers: new Headers({ Origin: "http://localhost:3000" }),
  });
}

describe("Better Auth Apple admission integration", () => {
  for (const email of ["operator@example.com", "relay@privaterelay.appleid.com"]) {
    it(`reuses one Apple user and account for repeated ${email} sign-in`, async () => {
      const instance = await appleProviderHarness(email, [email]);

      const first = await signInWithAppleIdToken(instance);
      const second = await signInWithAppleIdToken(instance);
      if (!("user" in first) || !("user" in second)) {
        throw new Error("Expected Apple ID-token sign-in to create a session.");
      }

      expect(first.user.id).toBe(second.user.id);
      expect(first.user.email).toBe(email);
      expect(await instance.db.count({ model: "user" })).toBe(1);
      expect(await instance.db.count({ model: "account" })).toBe(1);
      const [account] = await instance.db.findMany<{
        accountId: string;
        providerId: string;
        userId: string;
      }>({ model: "account" });
      expect(account).toMatchObject({
        accountId: "stable-apple-subject",
        providerId: "apple",
        userId: first.user.id,
      });
    });
  }

  it("persists no user or account for an unallowlisted Apple email", async () => {
    const instance = await appleProviderHarness("intruder@example.com", ["operator@example.com"]);

    await expect(signInWithAppleIdToken(instance)).rejects.toMatchObject({
      status: "UNAUTHORIZED",
    });
    expect(await instance.db.count({ model: "user" })).toBe(0);
    expect(await instance.db.count({ model: "account" })).toBe(0);
    expect(await instance.db.count({ model: "session" })).toBe(0);
  });
});
