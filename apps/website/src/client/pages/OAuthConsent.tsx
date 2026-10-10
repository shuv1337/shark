import {
  API_TOKEN_SCOPE_DESCRIPTIONS,
  type ApiTokenScope,
  OAUTH_API_SCOPES,
  OAUTH_OFFLINE_ACCESS_SCOPE,
} from "@hark/contracts";
import { useEffect, useMemo, useState } from "react";
import { Brand, PAGE_COLUMN } from "../components/SiteChrome";
import { primaryButton, secondaryButton } from "../components/ui";
import {
  getOAuthClientInfo,
  type OAuthClientInfo,
  oauthAuthClient,
  signedOAuthQuery,
  submitOAuthConsent,
} from "../lib/oauth-api";
import {
  canApproveConsent,
  consentedScopes,
  initialConsentSelection,
  isHighImpactScope,
} from "../lib/oauth-consent";

/** Actions an MCP client can never take, whatever it is granted. */
const HUMAN_ONLY = [
  "answer your prompts",
  "acknowledge or escalate pages",
  "accept team invites",
  "approve app sign-in",
  "create API tokens",
];

interface ConsentRequest {
  oauthQuery: string;
  clientId: string;
  apiScopes: ApiTokenScope[];
  offlineAccess: boolean;
  redirectHost: string | null;
  expired: boolean;
}

function readRequest(): ConsentRequest | null {
  const oauthQuery = signedOAuthQuery();
  if (!oauthQuery) return null;
  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get("client_id");
  if (!clientId) return null;
  const requested = new Set((params.get("scope") ?? "").split(" ").filter(Boolean));
  let redirectHost: string | null = null;
  try {
    const redirect = new URL(params.get("redirect_uri") ?? "");
    redirectHost = redirect.host || redirect.protocol.replace(/:$/, "");
  } catch {
    redirectHost = null;
  }
  const exp = Number(params.get("exp"));
  return {
    oauthQuery,
    clientId,
    apiScopes: OAUTH_API_SCOPES.filter((scope) => requested.has(scope)),
    offlineAccess: requested.has(OAUTH_OFFLINE_ACCESS_SCOPE),
    redirectHost,
    expired: Number.isFinite(exp) && exp > 0 && exp * 1000 < Date.now(),
  };
}

/**
 * OAuth consent page for MCP clients, served behind sign-in. The authorization
 * endpoint redirects here with a signed query; approving posts the scopes
 * the person left ticked and follows the redirect back to the client.
 */
export function OAuthConsent() {
  const request = useMemo(readRequest, []);
  const { data: session, isPending } = oauthAuthClient.useSession();
  const [client, setClient] = useState<OAuthClientInfo | null>(null);
  const [selected, setSelected] = useState<Set<ApiTokenScope>>(() =>
    initialConsentSelection(request?.apiScopes ?? []),
  );
  const [offlineAccess, setOfflineAccess] = useState(request?.offlineAccess ?? false);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request || request.expired) return;
    let cancelled = false;
    void getOAuthClientInfo(request.clientId, request.oauthQuery)
      .then((info) => {
        if (!cancelled) setClient(info);
      })
      .catch(() => {
        if (!cancelled) setClient({ client_id: request.clientId });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const clientName = client?.client_name?.trim() || "An MCP client";
  const granted = consentedScopes(selected, offlineAccess);
  const approvable = canApproveConsent(request?.apiScopes ?? [], selected, offlineAccess);

  const decide = async (accept: boolean) => {
    if (!request) return;
    setBusy(accept ? "approve" : "deny");
    setError(null);
    try {
      const scopes = accept ? granted : undefined;
      const url = await submitOAuthConsent(accept, scopes, request.oauthQuery);
      setDone(accept ? "approved" : "denied");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the authorization");
      setBusy(null);
    }
  };

  const toggle = (scope: ApiTokenScope) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`${PAGE_COLUMN} flex h-16 items-center justify-between`}>
        <Brand />
        {session ? (
          <span className="max-w-56 truncate text-sm text-ink-faint">{session.user.email}</span>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-6 pb-20">
        <section className="hark-glass w-full rounded-3xl p-5 sm:p-8">
          {!request || request.expired ? (
            <>
              <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-ink">
                {request?.expired ? "This request expired" : "Nothing to authorize"}
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
                Start the connection again from your MCP client. It opens this page with a fresh
                request.
              </p>
            </>
          ) : (
            <>
              <ClientHeader client={client} name={clientName} redirectHost={request.redirectHost} />

              {isPending ? (
                <p className="mt-6 text-[15px] text-ink-faint">Checking your session…</p>
              ) : !session ? (
                <p className="mt-6 text-[15px] leading-relaxed text-ink-muted">
                  Your session ended.{" "}
                  <a
                    className="text-ink underline decoration-line-strong underline-offset-2"
                    href={`/login?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`}
                  >
                    Sign in again
                  </a>{" "}
                  to continue.
                </p>
              ) : done ? (
                <div className="mt-6 rounded-2xl bg-surface-muted px-4 py-3 text-[15px] text-ink">
                  {done === "approved"
                    ? `Connected. Returning to ${clientName}…`
                    : `Denied. Returning to ${clientName}…`}
                </div>
              ) : (
                <>
                  <fieldset className="mt-6">
                    <legend className="text-[15px] font-medium text-ink">
                      Allow {clientName} to
                    </legend>
                    <ul className="mt-3 space-y-2">
                      {request.apiScopes.map((scope) => (
                        <ScopeOption
                          key={scope}
                          checked={selected.has(scope)}
                          description={API_TOKEN_SCOPE_DESCRIPTIONS[scope].description}
                          highImpact={isHighImpactScope(scope)}
                          label={API_TOKEN_SCOPE_DESCRIPTIONS[scope].label}
                          onChange={() => toggle(scope)}
                          scope={scope}
                        />
                      ))}
                      {request.offlineAccess ? (
                        <ScopeOption
                          checked={offlineAccess}
                          description="Refresh its access without asking again until you disconnect it. Unticked, you approve again about every hour."
                          label="Stay connected"
                          onChange={() => setOfflineAccess((value) => !value)}
                          scope={OAUTH_OFFLINE_ACCESS_SCOPE}
                        />
                      ) : null}
                    </ul>
                    {request.apiScopes.some(isHighImpactScope) ? (
                      <p className="mt-3 text-[13px] leading-5 text-ink-faint">
                        High-impact permissions start unticked. Tick them only if you want{" "}
                        {clientName} to have them. Leaving these unticked means SHark will ask again
                        next time this app connects.
                      </p>
                    ) : null}
                  </fieldset>

                  <p className="mt-4 text-[13px] leading-5 text-ink-faint">
                    It can never {HUMAN_ONLY.join(", ")}: those stay with you. Disconnect it any
                    time from your dashboard.
                  </p>

                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                      className={`${secondaryButton} h-11`}
                      disabled={busy !== null}
                      onClick={() => void decide(false)}
                      type="button"
                    >
                      {busy === "deny" ? "Denying…" : "Deny"}
                    </button>
                    <button
                      className={primaryButton}
                      disabled={busy !== null || !approvable}
                      onClick={() => void decide(true)}
                      type="button"
                    >
                      {busy === "approve" ? "Connecting…" : "Approve"}
                    </button>
                  </div>
                  {!approvable ? (
                    <p className="mt-3 text-[13px] text-ink-faint">
                      Choose at least one permission, or deny.
                    </p>
                  ) : null}
                </>
              )}
            </>
          )}

          {error ? (
            <div
              className="mt-5 rounded-2xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
              role="alert"
            >
              {error}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function ClientHeader({
  client,
  name,
  redirectHost,
}: {
  client: OAuthClientInfo | null;
  name: string;
  redirectHost: string | null;
}) {
  return (
    <div className="flex items-start gap-4">
      {client?.logo_uri ? (
        <img
          alt=""
          className="size-12 shrink-0 rounded-2xl bg-surface object-cover ring-1 ring-line"
          src={client.logo_uri}
        />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-lg font-medium text-on-accent">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-balance text-ink">
          Connect {name} to SHark
        </h1>
        <p className="mt-1 text-[13px] leading-5 text-ink-faint">
          {redirectHost ? (
            <>
              Returns to <span className="font-mono text-ink-muted">{redirectHost}</span>
            </>
          ) : null}
          {redirectHost && client?.client_uri ? " · " : null}
          {client?.client_uri ? (
            <a
              className="underline decoration-line-strong underline-offset-2 hover:text-ink"
              href={client.client_uri}
              rel="noreferrer noopener"
              target="_blank"
            >
              {safeHost(client.client_uri)}
            </a>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

function ScopeOption({
  scope,
  label,
  description,
  checked,
  onChange,
  highImpact = false,
}: {
  scope: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  highImpact?: boolean;
}) {
  const id = `scope-${scope.replace(/[^a-z]/gi, "-")}`;
  return (
    <li>
      <label
        className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3 transition-colors hover:bg-surface-hover has-[:checked]:border-line-strong has-[:checked]:bg-surface-hover"
        htmlFor={id}
      >
        <input
          checked={checked}
          className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded accent-accent"
          id={id}
          onChange={onChange}
          type="checkbox"
        />
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium text-ink">
            {label}
            {highImpact ? (
              <span className="rounded-full border border-danger-line bg-danger-soft px-2 py-0.5 text-[11px] leading-4 font-medium text-danger">
                High impact
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[13px] leading-5 text-ink-faint">{description}</span>
          <span className="mt-1 block font-mono text-[12px] text-ink-disabled">{scope}</span>
        </span>
      </label>
    </li>
  );
}
