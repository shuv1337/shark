import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import type { OAuthClientGrantListResponse } from "@hark/contracts";
import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client with the OAuth provider plugin. On the consent page it
 * attaches the signed authorization query (`oauth_query`) to sign-in and
 * consent requests, so signing in resumes the MCP client's authorization.
 */
export const oauthAuthClient = createAuthClient({ plugins: [oauthProviderClient()] });

/** Public details of the OAuth client asking for access. */
export interface OAuthClientInfo {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
}

/**
 * The signed part of the consent page's query string, as the server issued
 * it. Unsigned extra parameters are dropped so the signature still verifies.
 */
export function signedOAuthQuery(search = window.location.search): string | null {
  const params = new URLSearchParams(search);
  if (!params.has("sig")) return null;
  const signedNames = new Set(params.getAll("ba_param"));
  if (signedNames.size === 0) return null;
  const signed = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (key === "sig" || key === "ba_param" || signedNames.has(key)) signed.append(key, value);
  }
  return signed.toString();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    throw new Error(data.error_description ?? data.message ?? data.error ?? "Request failed");
  }
  return data;
}

export function getOAuthClientInfo(clientId: string, oauthQuery: string): Promise<OAuthClientInfo> {
  return postJson<OAuthClientInfo>("/api/auth/oauth2/public-client-prelogin", {
    client_id: clientId,
    oauth_query: oauthQuery,
  });
}

/**
 * Accepts (with the scopes the person left ticked) or denies the request.
 * Resolves to the URL to send the browser to: the client's redirect URI
 * with an authorization code or an `access_denied` error.
 */
export async function submitOAuthConsent(
  accept: boolean,
  scopes: string[] | undefined,
  oauthQuery: string,
): Promise<string> {
  const result = await postJson<{ url?: string; redirect_uri?: string }>(
    "/api/auth/oauth2/consent",
    {
      accept,
      ...(accept && scopes ? { scope: scopes.join(" ") } : {}),
      oauth_query: oauthQuery,
    },
  );
  const url = result.url ?? result.redirect_uri;
  if (!url) throw new Error("The authorization server did not return a redirect");
  return url;
}

/** Signs in and comes back to this consent page, resuming the authorization. */
export function signInForOAuth(): Promise<unknown> {
  return oauthAuthClient.signIn.social({
    provider: "apple",
    callbackURL: `${window.location.pathname}${window.location.search}`,
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "include", ...init });
  const data = (await response.json().catch(() => ({ error: "Request failed" }))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

/** Dashboard API for connected MCP/OAuth clients. */
export const oauthApi = {
  listClients: () => request<OAuthClientGrantListResponse>("/api/oauth/clients"),
  revokeClient: (clientId: string) =>
    request<{ ok: true }>(`/api/oauth/clients/${encodeURIComponent(clientId)}`, {
      method: "DELETE",
    }),
};
