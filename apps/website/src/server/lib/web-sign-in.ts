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
 * protocol bootstrap from becoming an open redirect.
 */
export async function beginAppleWebSignIn(
  authHandler: AuthHandler,
  appUrl: string,
): Promise<Response> {
  const response = await authHandler(
    new Request(new URL("/api/auth/sign-in/social", appUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: appUrl,
      },
      body: JSON.stringify({
        provider: "apple",
        callbackURL: "/dashboard",
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
