import { afterEach, describe, expect, it, vi } from "vitest";

process.env.EXPO_PUBLIC_APNS_ENVIRONMENT = "sandbox";

const state = vi.hoisted(() => ({
  instances: [] as Array<Record<string, unknown>>,
  uploads: [] as Array<Record<string, unknown>>,
  appStateListener: null as ((state: string) => void) | null,
  appStateRemove: vi.fn(),
  pushEnvironment: "development" as "development" | "production" | null,
}));

vi.mock("expo-application", () => ({
  getIosPushNotificationServiceEnvironmentAsync: async () => state.pushEnvironment,
}));
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => "dev_1" }));
vi.mock("expo-widgets", () => ({ addPushToStartTokenListener: () => ({ remove: vi.fn() }) }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    addEventListener: (_event: string, listener: (value: string) => void) => {
      state.appStateListener = listener;
      return { remove: state.appStateRemove };
    },
  },
}));
vi.mock("../widgets/HarkAgentActivity", () => ({
  default: { getInstances: () => state.instances },
}));
vi.mock("./interactions", () => ({ DEVICE_ID_KEY: "device-id" }));
vi.mock("./api", () => ({
  api: {
    registerLiveActivityUpdateToken: async (input: Record<string, unknown>) => {
      state.uploads.push(input);
    },
    registerLiveActivityPushToStartToken: vi.fn(),
  },
}));

import {
  nativeActivityId,
  startLiveActivityTokenSync,
  syncLiveActivityTokens,
} from "./live-activities";

function instance(id: unknown, token: string, usePublicId = false) {
  return {
    ...(usePublicId ? { getId: () => id } : { nativeLiveActivity: { id } }),
    getPushToken: async () => token,
    addPushTokenListener: () => ({ remove: vi.fn() }),
  };
}

afterEach(() => {
  state.instances = [];
  state.uploads.length = 0;
  state.appStateListener = null;
  state.appStateRemove.mockClear();
  state.pushEnvironment = "development";
});

describe("Live Activity token sync", () => {
  it("uploads each initial token with its SDK 57 native activity ID", async () => {
    state.instances = [
      instance("native-a", "aa".repeat(32), true),
      instance("native-b", "bb".repeat(32), true),
    ];
    await syncLiveActivityTokens("dev_1");
    expect(state.uploads).toEqual([
      expect.objectContaining({
        environment: "sandbox",
        nativeActivityId: "native-a",
        updateToken: "aa".repeat(32),
      }),
      expect.objectContaining({
        environment: "sandbox",
        nativeActivityId: "native-b",
        updateToken: "bb".repeat(32),
      }),
    ]);
  });

  it("uses the signed production entitlement instead of the build-mode fallback", async () => {
    state.pushEnvironment = "production";
    state.instances = [instance("native-production", "ab".repeat(32))];
    await syncLiveActivityTokens("dev_1");
    expect(state.uploads).toEqual([
      expect.objectContaining({
        environment: "production",
        nativeActivityId: "native-production",
      }),
    ]);
  });

  it("fails closed instead of guessing among multiple instances", async () => {
    const unavailable = instance(undefined, "cc".repeat(32));
    state.instances = [unavailable, instance("native-known", "dd".repeat(32))];
    await syncLiveActivityTokens("dev_1");
    expect(state.uploads).toEqual([
      expect.objectContaining({ nativeActivityId: "native-known", updateToken: "dd".repeat(32) }),
    ]);
    expect(nativeActivityId(unavailable as never)).toBeNull();
  });

  it("resyncs remote starts on foreground and removes the AppState listener", async () => {
    state.instances = [instance("native-initial", "ee".repeat(32))];
    const stop = startLiveActivityTokenSync();
    await vi.waitFor(() => expect(state.uploads).toHaveLength(1));

    state.instances = [instance("native-remote", "ff".repeat(32))];
    state.appStateListener?.("active");
    await vi.waitFor(() =>
      expect(state.uploads.at(-1)).toMatchObject({ nativeActivityId: "native-remote" }),
    );

    stop();
    expect(state.appStateRemove).toHaveBeenCalledOnce();
  });
});
