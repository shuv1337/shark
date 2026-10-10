import type { TeamDto } from "@hark/contracts";

/**
 * Team seat billing. SHark is a noncommercial fork with no billing provider,
 * so every team is on the free plan with unlimited seats. The remaining
 * exports support upstream-compatible team DTOs and the disabled portal route.
 */

interface TeamCustomer {
  id: string;
  name: string;
  /** Billing contact: the owner's email. */
  email?: string;
}

export function teamBillingConfigured(): boolean {
  return false;
}

export async function teamHasPaidPlan(_team: TeamCustomer, _useCache = true): Promise<boolean> {
  return false;
}

export async function teamSeats(
  _team: TeamCustomer,
  used: number,
): Promise<Pick<TeamDto, "seats" | "plan">> {
  return { plan: "free", seats: { used, available: null, billable: 0 } };
}

export async function syncTeamSeats(_team: TeamCustomer, _memberCount: number): Promise<void> {}

export async function createTeamBillingPortal(_team: TeamCustomer): Promise<string> {
  throw new Error("Billing is not configured");
}
