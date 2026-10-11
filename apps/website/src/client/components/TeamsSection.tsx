import type { TeamDto } from "@hark/contracts";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../lib/api";
import { TEAM_NAME_MAX_CHARS, teamSummary } from "../lib/teams";
import {
  Badge,
  EmptyState,
  ErrorText,
  errorMessage,
  Field,
  INPUT,
  LIST_PANEL,
  Modal,
  SkeletonList,
  TeamMark,
} from "./DashboardKit";
import { primaryButtonSmall, rowButton, secondaryButton } from "./ui";

/** The viewer's teams, linking to each team page. The body of `/teams`. */
export function TeamsSection({
  teams,
  error,
  onCreated,
}: {
  teams: TeamDto[] | null;
  error: string | null;
  onCreated: (team: TeamDto) => void;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <section aria-labelledby="teams-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold" id="teams-heading">
            Teams
          </h1>
          <p className="mt-1 text-sm text-ink-subtle">
            Share apps with the people you work with, and page whoever is on call.
          </p>
        </div>
        <button
          className={`${rowButton} self-start`}
          onClick={() => setCreating(true)}
          type="button"
        >
          New team
        </button>
      </div>

      {teams === null && !error ? (
        <SkeletonList className="mt-6" label="Loading your teams" rowClassName="h-16" rows={2} />
      ) : null}
      {teams?.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No teams yet">
            A team is a group of people who share apps and an on-call rotation: anyone on it can
            open the team's apps as themselves, and an agent can page whoever is on call right now.
            Create one with “New team” — you'll be the owner, and your own seat is free.
          </EmptyState>
        </div>
      ) : null}
      {teams && teams.length > 0 ? (
        <ul className={`${LIST_PANEL} mt-6`}>
          {teams.map((team) => (
            <li key={team.id}>
              <Link
                className="group -mx-4 flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-hover sm:-mx-5 sm:px-5"
                to={`/teams/${team.id}`}
              >
                <TeamMark name={team.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{team.name}</span>
                    {team.plan === "team" ? <Badge>Team plan</Badge> : null}
                  </span>
                  <span className="line-clamp-2 block text-[13px] text-ink-faint sm:truncate">
                    {teamSummary(team)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {creating ? (
        <CreateTeamModal
          onClose={() => setCreating(false)}
          onCreated={(team) => {
            setCreating(false);
            onCreated(team);
          }}
        />
      ) : null}
    </section>
  );
}

function CreateTeamModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (team: TeamDto) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { team } = await api.createTeam({ name: name.trim() });
      onCreated(team);
      navigate(`/teams/${team.id}`);
    } catch (err) {
      setError(errorMessage(err, "Could not create the team"));
      setBusy(false);
    }
  };

  return (
    <Modal
      busy={busy}
      description="You'll be the owner. Your own seat is free."
      onClose={onClose}
      onSubmit={submit}
      title="New team"
    >
      <Field label="Team name">
        <input
          className={INPUT}
          data-autofocus
          maxLength={TEAM_NAME_MAX_CHARS}
          onChange={(event) => setName(event.target.value)}
          placeholder="Platform"
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
          disabled={busy || name.trim().length === 0}
          type="submit"
        >
          {busy ? "Creating…" : "Create team"}
        </button>
      </div>
    </Modal>
  );
}
