import type * as Contracts from "@hark/contracts";
import type { AppDto, TeamDto, TeamRole } from "@hark/contracts";

// Contract constants mirrored as typed literals; importing the values would
// bundle zod into the client.
export const TEAM_NAME_MAX_CHARS: typeof Contracts.TEAM_NAME_MAX_CHARS = 60;
export const MAX_ESCALATION_STEPS: typeof Contracts.MAX_ESCALATION_STEPS = 5;

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** "a member", "an admin", "an owner". */
export function withArticle(role: TeamRole): string {
  const label = ROLE_LABELS[role].toLowerCase();
  return `${/^[aeiou]/.test(label) ? "an" : "a"} ${label}`;
}

/** Owners and admins manage members, invites and on-call groups. */
export function canManage(role: TeamRole): boolean {
  return role === "owner" || role === "admin";
}

/** "3 of 5 seats", or "3 seats" when the plan has no fixed cap. */
export function seatsLabel(team: TeamDto): string {
  const { used, available } = team.seats;
  if (available === null) return `${used} ${used === 1 ? "seat" : "seats"}`;
  return `${used} of ${available} ${available === 1 ? "seat" : "seats"}`;
}

export function teamSummary(team: TeamDto): string {
  return [
    ROLE_LABELS[team.role],
    `${team.memberCount} ${team.memberCount === 1 ? "member" : "members"}`,
    seatsLabel(team),
    ...(team.oncallGroupCount > 0
      ? [`${team.oncallGroupCount} on-call ${team.oncallGroupCount === 1 ? "group" : "groups"}`]
      : []),
  ].join(" · ");
}

/**
 * Whether the viewer added this team app. The contract only carries the
 * adder's display name, so this compares names; the server still decides.
 */
export function addedByViewer(app: AppDto, viewerName: string | null | undefined): boolean {
  return Boolean(app.addedBy && viewerName && app.addedBy === viewerName);
}
