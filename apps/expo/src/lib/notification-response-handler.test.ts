import type * as Notifications from "expo-notifications";
import { describe, expect, it, vi } from "vitest";
import { createNotificationResponseHandler } from "./notification-response-handler";

function response(actionIdentifier = "expo.modules.notifications.actions.DEFAULT") {
  return {
    actionIdentifier,
    notification: { date: 1_000, request: { identifier: "synthetic-notification" } },
  } as Notifications.NotificationResponse;
}

describe("notification response dispatch", () => {
  it("coalesces cold-launch and listener callbacks during and immediately after opening", async () => {
    let release = () => {};
    const handle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const dispatch = createNotificationResponseHandler(handle);
    const first = dispatch(response());
    const second = dispatch(response());
    await Promise.resolve();
    expect(handle).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    await dispatch(response());
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("allows a later intentional tap on the same notification", async () => {
    let clock = 0;
    const handle = vi.fn(async () => {});
    const dispatch = createNotificationResponseHandler(handle, () => clock);
    await dispatch(response());
    clock = 6_000;
    await dispatch(response());
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("leaves inline responses to the durable reply queue", async () => {
    const handle = vi.fn(async () => {});
    const dispatch = createNotificationResponseHandler(handle);
    await dispatch(response("HARK_REPLY"));
    await dispatch(response("HARK_REPLY"));
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it("does not suppress retry after failed local handling", async () => {
    const handle = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValue(undefined);
    const dispatch = createNotificationResponseHandler(handle);
    await expect(dispatch(response())).rejects.toThrow("synthetic failure");
    await dispatch(response());
    expect(handle).toHaveBeenCalledTimes(2);
  });
});
