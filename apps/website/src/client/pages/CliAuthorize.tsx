import type { DeviceAuthorizationRequestDto } from "@hark/contracts";
import { useEffect, useState } from "react";
import { AppleButton } from "../components/AppleButton";
import { GoogleButton } from "../components/GoogleButton";
import { Brand, PAGE_COLUMN } from "../components/SiteChrome";
import { primaryButton, secondaryButton } from "../components/ui";
import { api } from "../lib/api";
import { signInWithApple, signInWithGoogle, useSession } from "../lib/auth";

export function CliAuthorize() {
  const initialCode = new URLSearchParams(window.location.search).get("code") ?? "";
  const [code, setCode] = useState(initialCode);
  const [submittedCode, setSubmittedCode] = useState(initialCode);
  const [request, setRequest] = useState<DeviceAuthorizationRequestDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!session || !submittedCode) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .getDeviceAuthorization(submittedCode)
      .then((response) => {
        if (!cancelled) setRequest(response.request);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Authorization not found");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, submittedCode]);

  const lookUp = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    window.history.replaceState(null, "", `/cli/authorize?code=${encodeURIComponent(normalized)}`);
    setRequest(null);
    setSubmittedCode(normalized);
  };

  const resolve = async (action: "approve" | "deny") => {
    setBusy(true);
    setError(null);
    try {
      const response =
        action === "approve"
          ? await api.approveDeviceAuthorization(submittedCode)
          : await api.denyDeviceAuthorization(submittedCode);
      setRequest(response.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve authorization");
    } finally {
      setBusy(false);
    }
  };

  const callbackURL = `/cli/authorize?code=${encodeURIComponent(submittedCode || code.trim())}`;

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
          <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-white">
            Authorize a command-line client
          </h1>

          {!submittedCode ? (
            <form className="mt-6" onSubmit={lookUp}>
              <label className="text-[15px] text-ink-muted" htmlFor="device-code">
                Enter the code shown in your terminal
              </label>
              <input
                autoCapitalize="characters"
                autoComplete="one-time-code"
                className="hark-field mt-2 min-h-12 px-4 font-mono text-lg tracking-[0.12em] uppercase"
                id="device-code"
                maxLength={9}
                onChange={(event) => setCode(event.target.value)}
                placeholder="ABCD-EFGH"
                value={code}
              />
              <button className={`${primaryButton} mt-4 w-full`} type="submit">
                Continue
              </button>
            </form>
          ) : isPending ? (
            <p className="mt-6 text-[15px] text-ink-faint">Checking your session…</p>
          ) : !session ? (
            <div className="mt-6">
              <p className="mb-5 text-[15px] leading-relaxed text-ink-muted">
                Sign in to choose whether this client may access your Hark account. Signing in does
                not authorize it.
              </p>
              <div className="flex flex-wrap gap-3">
                <AppleButton onClick={() => void signInWithApple(callbackURL)} />
                <GoogleButton onClick={() => void signInWithGoogle(callbackURL)} />
              </div>
            </div>
          ) : loading ? (
            <p className="mt-6 text-[15px] text-ink-faint">Loading authorization request…</p>
          ) : request ? (
            <AuthorizationDetails request={request} busy={busy} onResolve={resolve} />
          ) : null}

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

function AuthorizationDetails({
  request,
  busy,
  onResolve,
}: {
  request: DeviceAuthorizationRequestDto;
  busy: boolean;
  onResolve: (action: "approve" | "deny") => Promise<void>;
}) {
  const pending = request.status === "pending";
  return (
    <div className="mt-6">
      <div className="rounded-2xl bg-panel p-4">
        <p className="text-[13px] text-ink-faint">Requesting client</p>
        <p className="mt-1 font-medium text-white">{request.clientName}</p>
        <div className="mt-4 flex items-end justify-between gap-4 border-t border-line pt-4">
          <div>
            <p className="text-[13px] text-ink-faint">Code</p>
            <p className="mt-1 font-mono text-lg tracking-[0.12em] text-white">
              {request.userCode}
            </p>
          </div>
          <p className="text-right text-[13px] leading-5 text-ink-faint">
            Request expires
            <br />
            {new Date(request.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <h2 className="text-[15px] font-medium text-white">Requested permissions</h2>
        <ul className="mt-2 space-y-2">
          {request.scopes.map((scope) => (
            <li
              className="rounded-xl border border-line px-3 py-2 font-mono text-[13px] text-ink"
              key={scope}
            >
              {scope}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[13px] text-ink-faint">
          Access token expires {new Date(request.tokenExpiresAt).toLocaleString()}.
        </p>
      </div>

      {pending ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            className={`${secondaryButton} h-11`}
            disabled={busy}
            onClick={() => void onResolve("deny")}
            type="button"
          >
            Deny
          </button>
          <button
            className={primaryButton}
            disabled={busy}
            onClick={() => void onResolve("approve")}
            type="button"
          >
            Authorize
          </button>
        </div>
      ) : (
        <div
          className={`mt-6 rounded-2xl px-4 py-3 text-[15px] ${request.status === "approved" || request.status === "consumed" ? "bg-white/12 text-white" : "bg-surface-hover text-ink-muted"}`}
        >
          {request.status === "approved" || request.status === "consumed"
            ? "Authorized. You can return to your terminal."
            : request.status === "denied"
              ? "Authorization denied."
              : "This authorization request expired."}
        </div>
      )}
    </div>
  );
}
