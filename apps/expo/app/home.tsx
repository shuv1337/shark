import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Redirect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomNav } from "../src/components/bottom-nav";
import { api } from "../src/lib/api";
import { useSession } from "../src/lib/auth";
import { APNS_TOKEN_KEY, EXPO_TOKEN_KEY } from "../src/lib/device-storage";
import { isSimulatorPreview } from "../src/lib/inbox-preview";
import {
  DEVICE_ID_KEY,
  flushInteractionResponses,
  registerInteractionCategories,
} from "../src/lib/interactions";
import { refreshLiveActivityTokenSync } from "../src/lib/live-activities";
import { colors, fonts, tightTracking } from "../src/lib/theme";

type PermissionState = "unknown" | "undetermined" | "granted" | "denied";
type RegistrationState = "idle" | "working" | "registered" | "error";

export default function DeviceScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [registration, setRegistration] = useState<RegistrationState>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const autoRegistrationAttempted = useRef(false);

  const refreshPermission = useCallback(async () => {
    const current = await Notifications.getPermissionsAsync();
    setPermission(current.granted ? "granted" : current.canAskAgain ? "undetermined" : "denied");
  }, []);

  useEffect(() => {
    void refreshPermission();
    void Promise.all([
      SecureStore.getItemAsync(EXPO_TOKEN_KEY),
      SecureStore.getItemAsync(DEVICE_ID_KEY),
    ])
      .then(([token, deviceId]) => {
        if (token && deviceId) setRegistration("registered");
      })
      .finally(() => setStorageHydrated(true));
  }, [refreshPermission]);

  const requestPermission = async () => {
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    setPermission(result.granted ? "granted" : result.canAskAgain ? "undetermined" : "denied");
  };

  const registerDevice = useCallback(
    async (preserveReadyState = false) => {
      if (!preserveReadyState) setRegistration("working");
      setLastError(null);
      try {
        if (!Device.isDevice) throw new Error("Push notifications require a physical iPhone.");
        const projectId =
          (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
          process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
        const expoToken = (
          await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
        ).data;
        let apns: string | null = null;
        try {
          const nativeToken = await Notifications.getDevicePushTokenAsync();
          apns = typeof nativeToken.data === "string" ? nativeToken.data : null;
        } catch {
          // Expo delivery remains available without direct APNs registration.
        }
        await registerInteractionCategories();
        const registered = await api.registerDevice({
          expoPushToken: expoToken,
          ...(apns ? { apnsToken: apns } : {}),
          platform: "ios",
          deviceName: Device.deviceName ?? undefined,
          interactionSchemaVersion: 1,
          liveActivityInteractionVersion: 1,
        });
        await Promise.all([
          SecureStore.setItemAsync(EXPO_TOKEN_KEY, expoToken),
          SecureStore.setItemAsync(DEVICE_ID_KEY, registered.device.id),
          apns
            ? SecureStore.setItemAsync(APNS_TOKEN_KEY, apns)
            : SecureStore.deleteItemAsync(APNS_TOKEN_KEY),
        ]);
        setRegistration("registered");
        void flushInteractionResponses();
        refreshLiveActivityTokenSync(registered.device.id);
        if (!preserveReadyState) router.replace("/inbox");
      } catch (error) {
        if (!preserveReadyState) {
          setRegistration("error");
          setLastError(error instanceof Error ? error.message : "Registration failed");
        }
      }
    },
    [router],
  );

  useEffect(() => {
    if (
      !storageHydrated ||
      !session ||
      permission !== "granted" ||
      autoRegistrationAttempted.current
    ) {
      return;
    }
    autoRegistrationAttempted.current = true;
    void registerDevice(registration === "registered");
  }, [permission, registerDevice, registration, session, storageHydrated]);

  if (!isPending && !session && !isSimulatorPreview) return <Redirect href="/" />;
  const ready = permission === "granted" && registration === "registered";

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <StatusBar style="auto" />
      <View style={styles.content}>
        <View style={styles.brand}>
          <Image source={require("../assets/splash-icon.png")} style={styles.logo} />
          <Text style={styles.brandText}>SHark</Text>
        </View>
        <Text style={styles.eyebrow}>This iPhone</Text>
        <Text style={styles.title}>
          {ready ? "Ready for notifications." : "Finish device setup."}
        </Text>
        <Text style={styles.subtitle}>Registration and delivery capabilities for this device.</Text>
        <StatusCard
          label="Notifications"
          value={
            permission === "granted"
              ? "Allowed"
              : permission === "denied"
                ? "Disabled in Settings"
                : "Permission required"
          }
          ready={permission === "granted"}
          action={permission === "undetermined" ? () => void requestPermission() : undefined}
          actionLabel="Allow"
        />
        <StatusCard
          label="Device registration"
          value={
            registration === "registered"
              ? "Registered"
              : registration === "working"
                ? "Registering…"
                : "Not registered"
          }
          ready={registration === "registered"}
          action={
            registration !== "working" && permission === "granted"
              ? () => void registerDevice(false)
              : undefined
          }
          actionLabel="Register"
        />
        {registration === "working" ? <ActivityIndicator color={colors.accent} /> : null}
        {lastError ? <Text style={styles.error}>{lastError}</Text> : null}
      </View>
      <BottomNav />
    </SafeAreaView>
  );
}

function StatusCard({
  label,
  value,
  ready,
  action,
  actionLabel,
}: {
  label: string;
  value: string;
  ready: boolean;
  action?: () => void;
  actionLabel: string;
}) {
  return (
    <View style={styles.card}>
      <View style={[styles.dot, ready && styles.dotReady]} />
      <View style={styles.cardCopy}>
        <Text style={styles.cardLabel}>{label}</Text>
        <Text style={styles.cardValue}>{value}</Text>
      </View>
      {action ? (
        <Pressable onPress={action} style={styles.action}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, paddingHorizontal: 24 },
  brand: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 9 },
  logo: { width: 32, height: 32 },
  brandText: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 18 },
  eyebrow: {
    marginTop: 30,
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 12,
    textTransform: "uppercase",
  },
  title: {
    maxWidth: 340,
    marginTop: 10,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: tightTracking(32),
  },
  subtitle: {
    marginTop: 12,
    marginBottom: 26,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.soft },
  dotReady: { backgroundColor: colors.accent },
  cardCopy: { flex: 1 },
  cardLabel: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 14 },
  cardValue: { marginTop: 3, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  action: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 15,
    backgroundColor: colors.accentSoft,
  },
  actionText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 12 },
  error: { marginTop: 12, color: colors.danger, fontFamily: fonts.regular, fontSize: 13 },
});
