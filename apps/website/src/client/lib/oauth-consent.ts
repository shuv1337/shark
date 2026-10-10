import {
  type ApiTokenScope,
  OAUTH_API_SCOPES,
  OAUTH_HIGH_IMPACT_SCOPES,
  OAUTH_OFFLINE_ACCESS_SCOPE,
} from "@hark/contracts";

const HIGH_IMPACT = new Set<string>(OAUTH_HIGH_IMPACT_SCOPES);

export function isHighImpactScope(scope: string): boolean {
  return HIGH_IMPACT.has(scope);
}

/** The requested API scopes ticked when the consent page opens: all but the high-impact ones. */
export function initialConsentSelection(requested: readonly ApiTokenScope[]): Set<ApiTokenScope> {
  return new Set(requested.filter((scope) => !isHighImpactScope(scope)));
}

/**
 * Whether Approve is available. A request for API scopes needs at least one
 * ticked, so unticking them all cannot leave an `offline_access`-only grant;
 * a request for `offline_access` alone needs it ticked.
 */
export function canApproveConsent(
  requested: readonly ApiTokenScope[],
  selected: ReadonlySet<ApiTokenScope>,
  offlineAccess: boolean,
): boolean {
  return requested.length > 0 ? selected.size > 0 : offlineAccess;
}

/**
 * The scopes an approval grants, in canonical order. `offline_access` alone
 * is a valid grant when it is all the client asked for.
 */
export function consentedScopes(
  selected: ReadonlySet<ApiTokenScope>,
  offlineAccess: boolean,
): string[] {
  return [
    ...OAUTH_API_SCOPES.filter((scope) => selected.has(scope)),
    ...(offlineAccess ? [OAUTH_OFFLINE_ACCESS_SCOPE] : []),
  ];
}
