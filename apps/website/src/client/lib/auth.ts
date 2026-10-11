import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { useSession, signOut } = authClient;

/**
 * Signing in lands on the board: it is what agents are waiting on, and it is
 * the manifest's `start_url`, so the installed app and the browser agree on
 * where "signed in" begins. A caller with somewhere specific in mind — a team
 * invite, a CLI authorization — passes its own path.
 */
export function signInWithApple(callbackURL = "/board"): Promise<unknown> {
  return authClient.signIn.social({
    provider: "apple",
    callbackURL,
  });
}
