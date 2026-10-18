type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export async function setAppBadge(count: number): Promise<void> {
  if (typeof navigator === "undefined") return;
  const badgeNavigator = navigator as BadgeNavigator;
  if (typeof badgeNavigator.setAppBadge !== "function") return;
  await badgeNavigator.setAppBadge(Math.max(0, Math.floor(count)));
}

export async function clearAppBadge(): Promise<void> {
  if (typeof navigator === "undefined") return;
  const badgeNavigator = navigator as BadgeNavigator;
  if (typeof badgeNavigator.clearAppBadge !== "function") return;
  await badgeNavigator.clearAppBadge();
}
