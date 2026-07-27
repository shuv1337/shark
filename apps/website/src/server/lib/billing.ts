import type { BillingDto } from "@hark/contracts";
import { env } from "../env";
import type { AuthedUser } from "../middleware";

/**
 * Compatibility adapter for clients and capability checks that still consume
 * BillingDto. SHark has one fixed, unmetered self-hosted entitlement.
 */
export function selfHostedBilling(): BillingDto {
  return {
    configured: false,
    plan: "pro",
    priceMonthly: 0,
    features: { deviceRouting: true },
    limits: {
      devices: null,
      // Retained only because BillingDto has a numeric compatibility field.
      // SHark never enforces or decrements this monthly value.
      notificationsPerMonth: 100_000,
      servicePerMinute: env.SERVICE_RATE_LIMIT_PER_MINUTE,
      accountPerMinute: env.ACCOUNT_RATE_LIMIT_PER_MINUTE,
    },
    usage: { notificationsRemaining: null },
  };
}

export async function getBilling(_user: AuthedUser, _useCache = false): Promise<BillingDto> {
  return selfHostedBilling();
}

export function clearBillingCache(_userId: string): void {
  // Compatibility no-op: SHark has no remote billing state.
}

export async function checkNotificationAllowance(_userId: string): Promise<boolean> {
  return true;
}

export async function trackNotification(_userId: string, _eventId: string): Promise<void> {
  // Compatibility no-op: notifications are not metered.
}
