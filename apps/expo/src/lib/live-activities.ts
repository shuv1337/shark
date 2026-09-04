import { LIVE_ACTIVITY_SCHEMA_VERSION } from "@hark/contracts";
import * as Application from "expo-application";
import * as SecureStore from "expo-secure-store";
import { addPushToStartTokenListener, type LiveActivity } from "expo-widgets";
import { AppState, Platform } from "react-native";
import HarkAgentActivity from "../widgets/HarkAgentActivity";
import { api } from "./api";
import { DEVICE_ID_KEY } from "./interactions";

type Subscription = { remove(): void };

let consumers = 0;
let pushToStartSubscription: Subscription | null = null;
let instanceSubscriptions: Subscription[] = [];
let appStateSubscription: Subscription | null = null;

async function environment(): Promise<"sandbox" | "production"> {
  try {
    const signedEnvironment = await Application.getIosPushNotificationServiceEnvironmentAsync();
    if (signedEnvironment === "development") return "sandbox";
    if (signedEnvironment === "production") return "production";
  } catch {
    // Fall through for platforms and test runtimes where the native API is unavailable.
  }
  const configured = process.env.EXPO_PUBLIC_APNS_ENVIRONMENT;
  if (configured === "production" || configured === "sandbox") return configured;
  return __DEV__ ? "sandbox" : "production";
}

async function deviceId(known?: string): Promise<string | null> {
  return known ?? SecureStore.getItemAsync(DEVICE_ID_KEY);
}

async function uploadUpdateToken(
  updateToken: string,
  knownDeviceId?: string,
  nativeActivityId?: string,
): Promise<void> {
  const id = await deviceId(knownDeviceId);
  if (!id) return;
  const tokenEnvironment = await environment();
  await api
    .registerLiveActivityUpdateToken({
      deviceId: id,
      updateToken,
      ...(nativeActivityId ? { nativeActivityId } : {}),
      environment: tokenEnvironment,
      schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
    })
    .catch(() => undefined);
}

/**
 * expo-widgets 57.0.17 exposes `getId()`. Older 57.0.x builds still keep the native SharedObject
 * as a runtime property even though TypeScript marks it private. Prefer the public method, then
 * fall back to that SDK-pinned escape hatch.
 */
export function nativeActivityId(instance: LiveActivity): string | null {
  const withPublicId = instance as LiveActivity & { getId?: () => string };
  if (typeof withPublicId.getId === "function") {
    try {
      const id = withPublicId.getId();
      if (typeof id === "string" && id.length > 0) return id;
    } catch {
      // Fall through to the private SharedObject property used by 57.0.6–57.0.16.
    }
  }
  const native = (instance as unknown as { nativeLiveActivity?: unknown }).nativeLiveActivity;
  if (!native || typeof native !== "object" || !("id" in native)) return null;
  const id = (native as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

async function observeInstance(
  instance: LiveActivity,
  knownDeviceId: string,
  allowUnassociatedUpload: boolean,
): Promise<void> {
  const activityId = nativeActivityId(instance);
  const token = await instance.getPushToken().catch(() => null);
  if (token && (activityId || allowUnassociatedUpload)) {
    await uploadUpdateToken(token, knownDeviceId, activityId ?? undefined);
  }
  instanceSubscriptions.push(
    instance.addPushTokenListener((event) => {
      void uploadUpdateToken(event.pushToken, knownDeviceId, event.activityId);
    }),
  );
}

function resetInstanceSubscriptions(): void {
  for (const subscription of instanceSubscriptions) subscription.remove();
  instanceSubscriptions = [];
}

function observePushToStart(knownDeviceId?: string): void {
  pushToStartSubscription?.remove();
  try {
    pushToStartSubscription = addPushToStartTokenListener((event) => {
      void (async () => {
        const id = await deviceId(knownDeviceId);
        if (!id) return;
        const tokenEnvironment = await environment();
        await api
          .registerLiveActivityPushToStartToken({
            deviceId: id,
            pushToStartToken: event.activityPushToStartToken,
            environment: tokenEnvironment,
            schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
          })
          .catch(() => undefined);
      })();
    });
  } catch {
    pushToStartSubscription = null;
  }
}

export async function syncLiveActivityTokens(knownDeviceId?: string): Promise<void> {
  if (Platform.OS !== "ios") return;
  const id = await deviceId(knownDeviceId);
  if (!id) return;
  resetInstanceSubscriptions();
  let instances: ReturnType<typeof HarkAgentActivity.getInstances>;
  try {
    instances = HarkAgentActivity.getInstances();
  } catch {
    return;
  }
  const allowUnassociatedUpload = instances.length === 1;
  await Promise.all(
    instances.map((instance) => observeInstance(instance, id, allowUnassociatedUpload)),
  );
}

export function startLiveActivityTokenSync(): () => void {
  consumers += 1;
  if (Platform.OS === "ios" && !pushToStartSubscription) observePushToStart();
  if (Platform.OS === "ios" && !appStateSubscription) {
    appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncLiveActivityTokens();
    });
  }
  void syncLiveActivityTokens();
  return () => {
    consumers = Math.max(0, consumers - 1);
    if (consumers > 0) return;
    pushToStartSubscription?.remove();
    pushToStartSubscription = null;
    appStateSubscription?.remove();
    appStateSubscription = null;
    resetInstanceSubscriptions();
  };
}

/** Re-subscribing makes the native module emit its current push-to-start token after registration. */
export function refreshLiveActivityTokenSync(knownDeviceId: string): void {
  if (Platform.OS !== "ios") return;
  observePushToStart(knownDeviceId);
  void syncLiveActivityTokens(knownDeviceId);
}
