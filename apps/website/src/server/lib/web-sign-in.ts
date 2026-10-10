import { CLIENT_IP_HEADER } from "./client-ip";

const APPLE_AUTH_ORIGIN = "https://appleid.apple.com";

type AuthHandler = (request: Request) => Promise<Response>;

function unavailable(): Response {
  return new Response(null, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Starts Better Auth's Apple flow without publishing a signed-out HTML page.
 * The callback is fixed and the provider URL is allowlisted to prevent this
 * protocol bootstrap from becoming an open redirect. `clientIp` is the caller's
 * trusted client IP (see client-ip.ts); Better Auth keys its `/sign-in/*` rate
 * limit on it, so without it every caller shares one bucket.
 */
export async function beginAppleWebSignIn(
  authHandler: AuthHandler,
  appUrl: string,
  callbackURL = "/dashboard",
  clientIp: string | null = null,
): Promise<Response> {
  const requestHeaders = new Headers({
    "Content-Type": "application/json",
    Origin: appUrl,
  });
  if (clientIp) requestHeaders.set(CLIENT_IP_HEADER, clientIp);
  const response = await authHandler(
    new Request(new URL("/api/auth/sign-in/social", appUrl), {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        provider: "apple",
        callbackURL,
      }),
    }),
  );
  if (!response.ok) return unavailable();

  let providerUrl: URL;
  try {
    const body = (await response.json()) as { url?: unknown };
    if (typeof body.url !== "string") return unavailable();
    providerUrl = new URL(body.url);
  } catch {
    return unavailable();
  }
  if (providerUrl.origin !== APPLE_AUTH_ORIGIN) return unavailable();

  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: providerUrl.toString(),
  });
  for (const cookie of response.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
}
