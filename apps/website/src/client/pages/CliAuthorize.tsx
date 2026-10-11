import type { DeviceAuthorizationRequestDto } from "@hark/contracts";
import { useEffect, useState } from "react";
import { AppleButton } from "../components/AppleButton";
import { primaryButton, secondaryButton, surfacePanel } from "../components/ui";
import { api } from "../lib/api";
import { signInWithApple, useSession } from "../lib/auth";

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
    <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-5 py-12 sm:px-6">
      <section className={`${surfacePanel} w-full rounded-2xl p-5 sm:p-8`}>
        <h1 className="text-2xl font-semibold text-balance">Authorize a command-line client</h1>
        <p className="mt-2 text-sm text-ink-subtle">
          A client running in your terminal is asking for access to this account.
        </p>

        {!submittedCode ? (
          <form className="mt-6" onSubmit={lookUp}>
            <label className="text-sm font-medium" htmlFor="device-code">
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
          <p className="mt-6 text-sm text-ink-faint">Checking your session…</p>
        ) : !session ? (
          <div className="mt-6">
            <p className="mb-5 text-sm leading-6 text-ink-subtle">
              Sign in to choose whether this client may access your SHark account. Signing in does
              not authorize it.
            </p>
            <AppleButton onClick={() => void signInWithApple(callbackURL)} />
          </div>
        ) : loading ? (
          <p className="mt-6 text-sm text-ink-faint">Loading authorization request…</p>
        ) : request ? (
          <AuthorizationDetails request={request} busy={busy} onResolve={resolve} />
        ) : null}

        {error ? (
          <div className="mt-5 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
      </section>
    </main>
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
      <div className="rounded-xl bg-panel p-4">
        <p className="text-xs text-ink-faint">Requesting client</p>
        <p className="mt-1 font-semibold">{request.clientName}</p>
        <div className="mt-4 flex items-end justify-between gap-4 border-t border-line pt-4">
          <div>
            <p className="text-xs text-ink-faint">Code</p>
            <p className="mt-1 font-mono text-lg font-semibold tracking-[0.12em]">
              {request.userCode}
            </p>
          </div>
          <p className="text-right text-xs leading-5 text-ink-faint">
            Request expires
            <br />
            {new Date(request.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <h2 className="text-sm font-semibold">Requested permissions</h2>
        <ul className="mt-2 space-y-2">
          {request.scopes.map((scope) => (
            <li
              className="rounded-lg border border-line px-3 py-2 font-mono text-xs text-ink-muted"
              key={scope}
            >
              {scope}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-faint">
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
          className={`mt-6 rounded-xl px-4 py-3 text-sm font-medium ${request.status === "approved" || request.status === "consumed" ? "bg-accent-soft text-accent-text" : "bg-surface-hover text-ink-muted"}`}
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
