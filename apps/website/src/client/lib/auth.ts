import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { useSession, signOut } = authClient;

export function signInWithApple(callbackURL = "/dashboard"): Promise<unknown> {
  return authClient.signIn.social({
    provider: "apple",
    callbackURL,
  });
}
