import type { AppDto, TeamDto, TeamMemberDto } from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  AppIcon,
  DashboardHeader,
  ErrorText,
  errorMessage,
  Field,
  INPUT,
  LIST_PANEL,
  Modal,
  SECTION,
  SectionHeading,
  TeamMark,
} from "../components/DashboardKit";
import { Brand, PAGE_COLUMN } from "../components/SiteChrome";
import { LeaveOrDelete, MembersSection } from "../components/team/Members";
import { OncallSection } from "../components/team/Oncall";
import { PagesSection } from "../components/team/Pages";
import { primaryButton, primaryButtonSmall, rowButton, secondaryButton } from "../components/ui";
import { ApiRequestError, api } from "../lib/api";
import { useSession } from "../lib/auth";
import { canManage, TEAM_NAME_MAX_CHARS, teamSummary } from "../lib/teams";

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; team: TeamDto; members: TeamMemberDto[] };

/** `/dashboard/teams/:teamId`: members, seats, on-call groups and pages for one team. */
export function TeamPage() {
  const { teamId = "" } = useParams();
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [renaming, setRenaming] = useState(false);
  const [pagesKey, setPagesKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const { team, members } = await api.getTeam(teamId);
      setState({ kind: "ready", team, members });
      return team;
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 404 || err.status === 403)) {
        setState({ kind: "missing" });
      } else {
        setState({ kind: "error", message: errorMessage(err, "Could not load this team") });
      }
      return null;
    }
  }, [teamId]);

  useEffect(() => {
    if (!isPending && !session) {
      navigate("/", { replace: true });
      return;
    }
    if (session) void load();
  }, [session, isPending, navigate, load]);

  if (isPending || !session) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header className={`${PAGE_COLUMN} flex h-16 items-center`}>
          <Brand />
        </header>
        <main className={`${PAGE_COLUMN} flex-1 pt-8`}>
          <p className="text-ink-faint" role="status">
            Loading…
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <DashboardHeader />
      <main className={`${PAGE_COLUMN} flex-1 pt-6 pb-16`}>
        <Link
          className="group mb-5 inline-flex items-center gap-1.5 text-[15px] text-ink-muted transition-colors hover:text-white"
          to="/dashboard"
        >
          <span
            aria-hidden="true"
            className="inline-block transition-transform group-hover:-translate-x-0.5"
          >
            ←
          </span>
          Dashboard
        </Link>

        {state.kind === "loading" ? (
          <p className="text-ink-faint" role="status">
            Loading team…
          </p>
        ) : null}

        {state.kind === "missing" ? (
          <div>
            <h1 className="text-[28px] leading-[1.15] font-medium tracking-[-0.015em] text-white">
              Team not found
            </h1>
            <p className="mt-2 max-w-[30rem] text-ink-muted">
              It may have been deleted, or you're no longer a member. Ask a team admin for a new
              invite.
            </p>
            <Link className={`${primaryButton} mt-6`} to="/dashboard">
              Back to dashboard
            </Link>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div
            className="rounded-2xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
            role="alert"
          >
            {state.message}{" "}
            <button className="underline" onClick={() => void load()} type="button">
              Try again
            </button>
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3.5">
                <TeamMark name={state.team.name} size="lg" />
                <div className="min-w-0">
                  <h1 className="truncate text-[28px] leading-[1.15] font-medium tracking-[-0.015em] text-white">
                    {state.team.name}
                  </h1>
                  <p className="mt-1 text-[15px] text-ink-muted">{teamSummary(state.team)}</p>
                </div>
              </div>
              {canManage(state.team.role) ? (
                <button
                  className={`${rowButton} mt-1 shrink-0`}
                  onClick={() => setRenaming(true)}
                  type="button"
                >
                  Rename
                </button>
              ) : null}
            </div>

            <MembersSection
              members={state.members}
              onChanged={async () => {
                await load();
              }}
              team={state.team}
              viewerId={session.user.id}
            />

            <OncallSection
              members={state.members}
              onPaged={() => setPagesKey((value) => value + 1)}
              team={state.team}
              viewerName={session.user.name || session.user.email}
            />

            <PagesSection refreshKey={pagesKey} teamId={state.team.id} />

            <TeamApps teamId={state.team.id} />

            <LeaveOrDelete
              onLeft={() => navigate("/dashboard", { replace: true })}
              team={state.team}
            />

            {renaming ? (
              <RenameModal
                onClose={() => setRenaming(false)}
                onRenamed={(team) => {
                  setRenaming(false);
                  setState((current) =>
                    current.kind === "ready"
                      ? { ...current, team: { ...current.team, ...team } }
                      : current,
                  );
                }}
                team={state.team}
              />
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function TeamApps({ teamId }: { teamId: string }) {
  const [apps, setApps] = useState<AppDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listTeamApps(teamId)
      .then((response) => {
        if (!cancelled) setApps(response.apps);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err, "Could not load team apps"));
          setApps([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  return (
    <section aria-labelledby="team-apps-heading" className={SECTION}>
      <SectionHeading
        id="team-apps-heading"
        title="Apps"
        description={
          <>
            Everyone on the team can open these in SHark, signed in as themselves. Share one from{" "}
            <Link className="hark-link" to="/dashboard">
              your apps
            </Link>
            .
          </>
        }
      />
      {apps === null ? <p className="py-4 text-ink-faint">Loading apps…</p> : null}
      {apps?.length === 0 && !error ? (
        <p className="rounded-3xl border border-dashed border-line-strong px-5 py-4 text-[15px] text-ink-muted">
          No team apps yet. Agents can add one straight to the team, or you can share one of yours.
        </p>
      ) : null}
      {apps && apps.length > 0 ? (
        <ul className={LIST_PANEL}>
          {apps.map((app) => (
            <li className="flex items-center gap-3 py-3.5" key={app.id}>
              <AppIcon app={app} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">{app.name}</p>
                <p className="truncate text-[13px] text-ink-faint">
                  <span className="font-mono">{app.origin}</span>
                  {app.addedBy ? ` · added by ${app.addedBy}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function RenameModal({
  team,
  onClose,
  onRenamed,
}: {
  team: TeamDto;
  onClose: () => void;
  onRenamed: (team: Partial<TeamDto>) => void;
}) {
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.updateTeam(team.id, { name: name.trim() });
      onRenamed(response?.team ?? { name: name.trim() });
    } catch (err) {
      setError(errorMessage(err, "Could not rename the team"));
      setBusy(false);
    }
  };

  return (
    <Modal busy={busy} onClose={onClose} onSubmit={submit} title="Rename team">
      <Field label="Team name">
        <input
          className={INPUT}
          data-autofocus
          maxLength={TEAM_NAME_MAX_CHARS}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="mt-6 flex justify-end gap-2">
        <button className={secondaryButton} disabled={busy} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={primaryButtonSmall}
          disabled={busy || name.trim().length === 0 || name.trim() === team.name}
          type="submit"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
