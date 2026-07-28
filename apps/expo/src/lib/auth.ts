import { expoClient } from "@better-auth/expo/client";
import type { BetterAuthClientPlugin } from "better-auth";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

/**
 * In development point this at your machine's LAN address so the device or
 * simulator can reach the Hono API, e.g. EXPO_PUBLIC_API_URL=http://192.168.1.20:8787
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

// The cast works around a known @better-auth/expo type mismatch against
// better-auth's BetterAuthClientPlugin (see better-auth #2031); the plugin is
// correct at runtime.
const expoPlugin = expoClient({
  scheme: "shark",
  storagePrefix: "hark",
  storage: SecureStore,
}) as unknown as BetterAuthClientPlugin;

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [expoPlugin],
});

/** Session cookie header value managed by the Better Auth Expo plugin. */
export function getCookie(): string {
  return (authClient as unknown as { getCookie: () => string }).getCookie();
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/** Typed wrapper around useSession (plugin cast above erases inference). */
export function useSession(): { data: { user: SessionUser } | null; isPending: boolean } {
  return authClient.useSession() as unknown as {
    data: { user: SessionUser } | null;
    isPending: boolean;
  };
}
