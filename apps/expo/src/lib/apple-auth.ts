import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { API_URL, authClient, getCookie } from "./auth";

function randomHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function randomToken(): Promise<string> {
  return randomHex(await Crypto.getRandomBytesAsync(32));
}

export function isAppleSignInCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ERR_REQUEST_CANCELED"
  );
}

export async function signInWithApple(): Promise<"signed-in" | "cancelled"> {
  const [nonce, state] = await Promise.all([randomToken(), randomToken()]);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      nonce,
      state,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (error) {
    if (isAppleSignInCancellation(error)) return "cancelled";
    throw error;
  }

  if (credential.state !== state) throw new Error("Apple sign-in state did not match");
  if (!credential.identityToken || !credential.authorizationCode) {
    throw new Error("Apple did not return the credentials needed to sign in");
  }

  const firstName = credential.fullName?.givenName ?? undefined;
  const lastName = credential.fullName?.familyName ?? undefined;
  const result = await authClient.signIn.social({
    provider: "apple",
    callbackURL: "/home",
    idToken: {
      token: credential.identityToken,
      nonce,
      user:
        firstName || lastName || credential.email
          ? {
              name: { firstName, lastName },
              email: credential.email ?? undefined,
            }
          : undefined,
    },
  });
  if (result.error) throw new Error(result.error.message ?? "Apple sign-in failed");

  try {
    const response = await fetch(`${API_URL}/api/apple-auth/native-token`, {
      method: "POST",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        cookie: getCookie(),
      },
      body: JSON.stringify({
        authorizationCode: credential.authorizationCode,
        identityToken: credential.identityToken,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? "Could not secure Apple account deletion access");
    }
  } catch (error) {
    await authClient.signOut().catch(() => undefined);
    throw error;
  }

  return "signed-in";
}
