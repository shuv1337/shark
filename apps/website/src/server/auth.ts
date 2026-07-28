import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { db } from "./db";
import * as schema from "./db/schema";
import { env } from "./env";
import { ADMISSION_DENIED_MESSAGE, isEmailAllowed } from "./lib/admission";
import { appleAuthConfig, generateAppleClientSecret, revokeAppleGrantsForUser } from "./lib/apple";

export const auth = betterAuth({
  appName: "SHark",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  account: {
    encryptOAuthTokens: true,
  },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => revokeAppleGrantsForUser(user.id),
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isEmailAllowed(user.email)) {
            console.warn("[auth] provider=apple outcome=admission_denied");
            throw APIError.from("FORBIDDEN", {
              message: ADMISSION_DENIED_MESSAGE,
              code: "ACCOUNT_NOT_AUTHORIZED",
            });
          }
          return { data: user };
        },
      },
      update: {
        before: async (user) => {
          if (user.email && !isEmailAllowed(user.email)) {
            console.warn("[auth] provider=apple outcome=admission_denied");
            throw APIError.from("FORBIDDEN", {
              message: ADMISSION_DENIED_MESSAGE,
              code: "ACCOUNT_NOT_AUTHORIZED",
            });
          }
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          const user = await context?.context.internalAdapter.findUserById(session.userId);
          if (!user || !isEmailAllowed(user.email)) {
            console.warn("[auth] provider=apple outcome=session_denied");
            throw APIError.from("FORBIDDEN", {
              message: ADMISSION_DENIED_MESSAGE,
              code: "ACCOUNT_NOT_AUTHORIZED",
            });
          }
        },
      },
    },
  },
  socialProviders: {
    apple: async () => {
      const clientId = env.APPLE_SIGN_IN_SERVICE_ID ?? "";
      const configured =
        clientId && env.APPLE_TEAM_ID && env.APPLE_SIGN_IN_KEY_ID && env.APPLE_SIGN_IN_PRIVATE_KEY;
      return {
        clientId,
        clientSecret: configured
          ? await generateAppleClientSecret(
              clientId,
              appleAuthConfig(),
              undefined,
              180 * 24 * 60 * 60,
            )
          : "",
        appBundleIdentifier: env.APPLE_SIGN_IN_BUNDLE_ID,
        // Better Auth 1.6.25's appBundleIdentifier alone replaces the web audience;
        // audience explicitly accepts both the Services ID and native App ID.
        audience: [clientId, env.APPLE_SIGN_IN_BUNDLE_ID],
      };
    },
  },
  plugins: [expo()],
  trustedOrigins: [env.APP_URL, "https://appleid.apple.com", "shark://", "shark://*"],
  advanced: env.APP_URL.startsWith("https://")
    ? {
        // Apple returns OAuth callbacks with a cross-site form POST. Better Auth
        // 1.6.25 still requires its signed state cookie on that request.
        cookies: {
          state: { attributes: { sameSite: "none", secure: true } },
        },
      }
    : undefined,
});

export type Session = typeof auth.$Infer.Session;
