import type { AppDto } from "@hark/contracts";
import * as Device from "expo-device";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon } from "../../src/components/app-icon";
import { api } from "../../src/lib/api";
import { previewApps } from "../../src/lib/inbox-preview";
import { colors, fonts, tightTracking } from "../../src/lib/theme";
import { cacheApps, cachedApp } from "../../src/lib/web-apps";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AppDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const [app, setApp] = useState<AppDto | null>(() => cachedApp(String(id)) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (simulatorPreview) {
      const preview = cachedApp(String(id)) ?? previewApps.find((item) => item.id === id);
      if (preview) setApp(preview);
      return;
    }
    void api
      .getApp(String(id))
      .then((result) => {
        cacheApps([result.app]);
        setApp(result.app);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Couldn’t load this app."),
      );
  }, [id, simulatorPreview]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/apps"));

  const update = async (change: { shareName?: boolean; shareEmail?: boolean }) => {
    if (!app || saving) return;
    const optimistic = { ...app, ...change };
    setApp(optimistic);
    if (simulatorPreview) {
      cacheApps([optimistic]);
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateAppSharing(app.id, change);
      cacheApps([result.app]);
      setApp(result.app);
    } catch (cause) {
      setApp(app);
      Alert.alert("Couldn’t save", cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const stopSigningIn = () => {
    if (!app) return;
    Alert.alert(
      `Stop signing in to ${app.name}?`,
      `SHark will stop sending passes to ${new URL(app.origin).host}. You’ll be asked again the next time you open it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop signing in",
          style: "destructive",
          onPress: () => {
            if (simulatorPreview) {
              const revoked = { ...app, consentedAt: null };
              cacheApps([revoked]);
              setApp(revoked);
              return;
            }
            void api
              .revokeApp(app.id)
              .then((result) => {
                cacheApps([result.app]);
                setApp(result.app);
              })
              .catch((cause: unknown) =>
                Alert.alert("Couldn’t update", cause instanceof Error ? cause.message : ""),
              );
          },
        },
      ],
    );
  };

  const remove = () => {
    if (!app) return;
    Alert.alert(
      `Remove ${app.name}?`,
      "It disappears from SHark on every device. Agents can add it again later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            if (simulatorPreview) return router.replace("/apps");
            void api
              .removeApp(app.id)
              .then(() => router.replace("/apps"))
              .catch((cause: unknown) =>
                Alert.alert("Couldn’t remove", cause instanceof Error ? cause.message : ""),
              );
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={back}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        >
          <SymbolView name="chevron.left" size={18} tintColor={colors.ink} weight="semibold" />
        </Pressable>
      </View>
      {!app ? (
        error ? (
          <Text style={styles.missing}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        )
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.identity}>
            <AppIcon iconUrl={app.iconUrl} name={app.name} size={60} />
            <View style={styles.identityCopy}>
              <Text style={styles.title}>{app.name}</Text>
              <Text style={styles.host}>{new URL(app.origin).host}</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/web/[id]", params: { id: app.id } })}
            style={({ pressed }) => [styles.openButton, pressed && styles.openButtonPressed]}
          >
            <Text style={styles.openButtonText}>Open app</Text>
          </Pressable>

          <View style={styles.metaBlock}>
            <MetaRow label="Added by" value={app.createdBy ?? "Unknown"} />
            <MetaRow label="Added" value={formatDate(app.createdAt)} />
            <MetaRow label="Last opened" value={formatDate(app.lastOpenedAt)} />
            <MetaRow
              label="Sign-in"
              value={app.consentedAt ? "Signed in with SHark" : "Asks before signing in"}
            />
          </View>

          <Text style={styles.sectionLabel}>Shared with {app.name}</Text>
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>SHark ID</Text>
              <Text style={styles.rowValue}>A private ID made just for this app</Text>
            </View>
            <Text style={styles.always}>Always</Text>
          </View>
          <View style={styles.row}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text style={styles.rowValue}>{app.shareName ? "Shared" : "Not shared"}</Text>
            </View>
            <Switch
              accessibilityLabel="Share name"
              onValueChange={(value) => void update({ shareName: value })}
              trackColor={{ true: colors.accent, false: colors.line }}
              value={app.shareName}
            />
          </View>
          <View style={[styles.row, styles.lastRow]}>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel}>Email</Text>
              <Text style={styles.rowValue}>{app.shareEmail ? "Shared" : "Not shared"}</Text>
            </View>
            <Switch
              accessibilityLabel="Share email"
              onValueChange={(value) => void update({ shareEmail: value })}
              trackColor={{ true: colors.accent, false: colors.line }}
              value={app.shareEmail}
            />
          </View>

          {app.consentedAt ? (
            <Pressable
              accessibilityRole="button"
              onPress={stopSigningIn}
              style={({ pressed }) => [styles.action, pressed && styles.rowPressed]}
            >
              <Text style={styles.actionLabel}>Stop signing in</Text>
              <Text style={styles.actionDetail}>
                SHark stops sending passes. {app.name} may keep its own session until it expires.
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={remove}
            style={({ pressed }) => [styles.action, pressed && styles.rowPressed]}
          >
            <Text style={styles.removeLabel}>Remove app</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonPressed: {
    backgroundColor: colors.accentSoft,
    transform: [{ scale: 0.96 }],
  },
  loading: {
    paddingVertical: 40,
  },
  missing: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 64,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  identityCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: tightTracking(22),
  },
  host: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  openButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    borderRadius: 22,
    backgroundColor: colors.accent,
  },
  openButtonPressed: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.98 }],
  },
  openButtonText: {
    color: colors.accentForeground,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  metaBlock: {
    gap: 6,
    marginTop: 24,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
  },
  metaLabel: {
    width: 84,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  metaValue: {
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  sectionLabel: {
    marginTop: 26,
    paddingBottom: 8,
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  lastRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowPressed: {
    opacity: 0.65,
  },
  rowCopy: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  rowLabel: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  rowValue: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  always: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  action: {
    minHeight: 52,
    justifyContent: "center",
    gap: 3,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  actionLabel: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  actionDetail: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: tightTracking(12),
  },
  removeLabel: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
});
