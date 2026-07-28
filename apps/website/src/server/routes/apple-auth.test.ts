import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APPLE_SIGN_IN_BUNDLE_ID = "dev.shuv.shark";

const appleMocks = vi.hoisted(() => ({
  subject: "apple-subject",
  exchange: vi.fn(async () => ({ refreshToken: "native-refresh", identityToken: "response-id" })),
}));

vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "apple_user", name: "Apple User", email: "relay@example.com", image: null },
      }),
    },
  },
}));

vi.mock("../lib/apple", () => {
  class AppleOAuthError extends Error {
    constructor(
      message: string,
      readonly code?: string,
    ) {
      super(message);
    }
  }
  return {
    AppleOAuthError,
    appleAuthConfig: () => ({}),
    verifyAppleIdentityToken: async () => appleMocks.subject,
    exchangeAppleAuthorizationCode: appleMocks.exchange,
  };
});

let route: typeof import("./apple-auth")["appleAuthRoute"];
let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");

beforeAll(async () => {
  ({ appleAuthRoute: route } = await import("./apple-auth"));
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values({
    id: "apple_user",
    name: "Apple User",
    email: "relay@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.account).values({
    id: "apple_account",
    accountId: "apple-subject",
    providerId: "apple",
    userId: "apple_user",
    createdAt: now,
    updatedAt: now,
  });
});

beforeEach(async () => {
  appleMocks.subject = "apple-subject";
  appleMocks.exchange.mockClear();
  await db.delete(schema.appleNativeGrant);
});

async function exchange(code: string) {
  return route.request("/native-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authorizationCode: code, identityToken: "identity-token" }),
  });
}

describe("POST /native-token", () => {
  it("stores an account-bound native refresh token encrypted", async () => {
    const response = await exchange("single-use-code");
    expect(response.status).toBe(200);
    expect(appleMocks.exchange).toHaveBeenCalledWith(
      "single-use-code",
      "dev.shuv.shark",
      "apple-subject",
      {},
    );

    const [stored] = await db
      .select()
      .from(schema.appleNativeGrant)
      .where(eq(schema.appleNativeGrant.userId, "apple_user"));
    expect(stored?.refreshTokenCiphertext).not.toContain("native-refresh");
    const { decryptAppleRefreshToken } = await import("../lib/token");
    expect(decryptAppleRefreshToken(stored?.refreshTokenCiphertext ?? "")).toBe("native-refresh");
  });

  it("rejects replay before contacting Apple", async () => {
    expect((await exchange("replayed-code")).status).toBe(200);
    appleMocks.exchange.mockClear();
    const replay = await exchange("replayed-code");
    expect(replay.status).toBe(409);
    expect(appleMocks.exchange).not.toHaveBeenCalled();
  });

  it("updates one native grant across repeated Apple exchanges without duplicating it", async () => {
    expect((await exchange("first-code")).status).toBe(200);
    expect((await exchange("second-code")).status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.appleNativeGrant)
        .where(eq(schema.appleNativeGrant.userId, "apple_user")),
    ).toHaveLength(1);
  });

  it("rejects a valid Apple identity not linked to the authenticated user", async () => {
    appleMocks.subject = "different-subject";
    const response = await exchange("other-code");
    expect(response.status).toBe(403);
    expect(appleMocks.exchange).not.toHaveBeenCalled();
  });
});
