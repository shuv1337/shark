import { describe, expect, it } from "vitest";
import {
  checkNotificationAllowance,
  getBilling,
  selfHostedBilling,
  trackNotification,
} from "./billing";

const user = { id: "usr_1", name: "Operator", email: "operator@example.com" };

describe("self-hosted entitlements", () => {
  it("enables the complete unmetered capability set", async () => {
    expect(await getBilling(user)).toEqual(selfHostedBilling());
    expect(selfHostedBilling()).toMatchObject({
      configured: false,
      plan: "pro",
      priceMonthly: 0,
      features: { deviceRouting: true },
      limits: {
        devices: null,
        notificationsPerMonth: 100_000,
        servicePerMinute: 300,
        accountPerMinute: 1500,
      },
      usage: { notificationsRemaining: null },
    });
  });

  it("always allows notifications without metering", async () => {
    await expect(checkNotificationAllowance(user.id)).resolves.toBe(true);
    await expect(trackNotification(user.id, "evt_1")).resolves.toBeUndefined();
  });
});
