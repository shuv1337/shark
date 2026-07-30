import * as Notifications from "expo-notifications";
import { Redirect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomNav } from "../src/components/bottom-nav";
import { api } from "../src/lib/api";
import { authClient, useSession } from "../src/lib/auth";
import { APNS_TOKEN_KEY, EXPO_TOKEN_KEY } from "../src/lib/device-storage";
import { isSimulatorPreview } from "../src/lib/inbox-preview";
import { clearInteractionResponses, DEVICE_ID_KEY } from "../src/lib/interactions";
import { colors, fonts, tightTracking } from "../src/lib/theme";

export default function SettingsScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const clearDevice = async () => {
    const expoToken = await SecureStore.getItemAsync(EXPO_TOKEN_KEY);
    if (expoToken) await api.unregisterDevice({ expoPushToken: expoToken }).catch(() => {});
    await Promise.all([
      SecureStore.deleteItemAsync(EXPO_TOKEN_KEY),
      SecureStore.deleteItemAsync(APNS_TOKEN_KEY),
      SecureStore.deleteItemAsync(DEVICE_ID_KEY),
      clearInteractionResponses(),
      Notifications.setBadgeCountAsync(0).catch(() => false),
    ]);
  };

  const signOut = () => {
    Alert.alert("Sign out", "This device will stop receiving notifications.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () =>
          void (async () => {
            await clearDevice();
            await authClient.signOut();
            router.replace("/");
          })(),
      },
    ]);
  };

  const deleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your services, complete inbox history, and registered devices.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () =>
            void (async () => {
              try {
                await clearDevice();
                const result = await authClient.deleteUser();
                if (result.error)
                  throw new Error(result.error.message ?? "Account deletion failed");
                router.replace("/");
              } catch (error) {
                Alert.alert(
                  "Could not delete account",
                  error instanceof Error ? error.message : "Please try again.",
                );
              }
            })(),
        },
      ],
    );
  };

  if (!isPending && !session && !isSimulatorPreview) return <Redirect href="/" />;
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <StatusBar style="auto" />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>SHark</Text>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.section}>History</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account-wide history</Text>
          <Text style={styles.cardBody}>
            Notifications are retained until this account is deleted. Reading an item syncs across
            your devices.
          </Text>
          <Pressable
            onPress={() => void api.markAllInboxRead()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryButtonText}>Mark everything read</Text>
          </Pressable>
        </View>
        <Text style={styles.section}>Account</Text>
        <Pressable
          onPress={signOut}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Text style={styles.rowText}>Sign out</Text>
        </Pressable>
        <Pressable
          onPress={deleteAccount}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
      </View>
      <BottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, paddingHorizontal: 24 },
  eyebrow: {
    marginTop: 34,
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 11,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 4,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 30,
    letterSpacing: tightTracking(30),
  },
  section: {
    marginTop: 30,
    marginBottom: 9,
    color: colors.soft,
    fontFamily: fonts.semibold,
    fontSize: 11,
    textTransform: "uppercase",
  },
  card: {
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  cardTitle: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 15 },
  cardBody: {
    marginTop: 7,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  secondaryButton: {
    alignSelf: "flex-start",
    marginTop: 14,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
  },
  secondaryButtonText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 12 },
  row: {
    minHeight: 54,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowText: { color: colors.ink, fontFamily: fonts.medium, fontSize: 15 },
  deleteText: { color: colors.danger, fontFamily: fonts.medium, fontSize: 15 },
  pressed: { opacity: 0.62 },
});
