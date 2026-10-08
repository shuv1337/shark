import type { AppDto } from "@hark/contracts";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon } from "../../src/components/app-icon";
import { BottomNav } from "../../src/components/bottom-nav";
import { api } from "../../src/lib/api";
import { useSession } from "../../src/lib/auth";
import { previewApps } from "../../src/lib/inbox-preview";
import { createRefreshSequence } from "../../src/lib/inbox-refresh";
import { DEVICE_ID_KEY } from "../../src/lib/interactions";
import { previewPending, previewProjects } from "../../src/lib/project-preview";
import { colors, fonts, tightTracking } from "../../src/lib/theme";
import { cacheApps, cachedApp } from "../../src/lib/web-apps";

const ADD_APP_COMMAND = 'sharkctl apps create --name "My app" --url https://…';

export default function AppsScreen() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [apps, setApps] = useState<AppDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const refreshSequence = useRef(createRefreshSequence()).current;

  useEffect(() => {
    void SecureStore.getItemAsync(DEVICE_ID_KEY).then((value) =>
      setDeviceId(value ?? (simulatorPreview ? "preview-device" : "")),
    );
  }, [simulatorPreview]);

  const refresh = useCallback(async () => {
    const token = refreshSequence.begin();
    if (simulatorPreview) {
      // Keep consent granted earlier in this preview session.
      const apps = previewApps.map((app) => cachedApp(app.id) ?? app);
      cacheApps(apps);
      setApps(apps);
      setUnread(previewProjects.totalUnread);
      setWaiting(previewPending.length);
      setLoadError(false);
      return;
    }
    const [appResult, pendingResult, projectResult] = await Promise.all([
      api.listApps(),
      api.listPendingInteractions().catch(() => null),
      api.listInboxProjects().catch(() => null),
    ]);
    if (!refreshSequence.isCurrent(token)) return;
    cacheApps(appResult.apps);
    setApps(appResult.apps);
    setLoadError(false);
    const pendingCount = pendingResult?.interactions.length ?? 0;
    const unreadCount = projectResult?.totalUnread ?? 0;
    setWaiting(pendingCount);
    setUnread(unreadCount);
    // Same badge rule as the inbox: pending requests plus unread notifications.
    if (pendingResult && projectResult) {
      void Notifications.setBadgeCountAsync(pendingCount + unreadCount).catch(() => {});
    }
  }, [refreshSequence, simulatorPreview]);

  const ready = Boolean((session || simulatorPreview) && deviceId);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    void refresh()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    const notificationSubscription = Notifications.addNotificationReceivedListener(() => {
      void refresh().catch(() => {});
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(() => {});
    });
    return () => {
      notificationSubscription.remove();
      appStateSubscription.remove();
    };
  }, [ready, refresh]);

  // Returning from an app, the inbox, or app info updates order and counts.
  const skipFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocus.current) {
        skipFirstFocus.current = false;
        return;
      }
      if (ready) void refresh().catch(() => {});
    }, [ready, refresh]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  };

  if (!sessionPending && !session && !simulatorPreview) return <Redirect href="/" />;
  if (deviceId === "") return <Redirect href="/home" />;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar style="auto" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <View style={styles.brandGroup}>
            <View style={styles.brandMark} />
            <Text style={styles.brand}>SHark</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
              accessibilityRole="button"
              onPress={() => router.push("/projects")}
              style={({ pressed }) => [styles.headerButton, pressed && styles.iconButtonPressed]}
            >
              <SymbolView name="tray.fill" size={18} tintColor={colors.muted} />
              {unread > 0 ? (
                <View style={styles.headerBadge}>
                  <Text style={styles.headerBadgeText}>{unread > 99 ? "99+" : unread}</Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              accessibilityLabel="Settings"
              accessibilityRole="button"
              onPress={() => router.push("/settings")}
              style={({ pressed }) => [styles.headerButton, pressed && styles.iconButtonPressed]}
            >
              <SymbolView name="gearshape.fill" size={17} tintColor={colors.muted} />
            </Pressable>
          </View>
        </View>

        {waiting > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/inbox")}
            style={({ pressed }) => [styles.waitingRow, pressed && styles.rowPressed]}
          >
            <View style={styles.waitingDot} />
            <Text style={styles.waitingText}>
              {waiting === 1
                ? "1 request is waiting on you"
                : `${waiting} requests are waiting on you`}
            </Text>
            <SymbolView name="chevron.right" size={11} tintColor={colors.soft} weight="semibold" />
          </Pressable>
        ) : null}

        {loading && apps.length === 0 ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : apps.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {loadError ? "Couldn’t load your apps" : "Your apps live here"}
            </Text>
            <Text style={styles.emptyBody}>
              {loadError
                ? "Pull down to try again."
                : "Register any web app you run and open it here, already signed in with SHark. Ask an agent, or run:"}
            </Text>
            {loadError ? null : (
              <View style={styles.command}>
                <Text selectable style={styles.commandText}>
                  {ADD_APP_COMMAND}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.grid}>
            {apps.map((app) => (
              <Pressable
                accessibilityHint="Opens the app. Long press for app info."
                accessibilityLabel={app.name}
                accessibilityRole="button"
                delayLongPress={350}
                key={app.id}
                onLongPress={() => router.push({ pathname: "/apps/[id]", params: { id: app.id } })}
                onPress={() => router.push({ pathname: "/web/[id]", params: { id: app.id } })}
                style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              >
                <AppIcon iconUrl={app.iconUrl} name={app.name} size={62} />
                <Text numberOfLines={1} style={styles.tileLabel}>
                  {app.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  brandRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandMark: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  brand: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 18,
    letterSpacing: tightTracking(18),
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: -10,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonPressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
  headerBadge: {
    position: "absolute",
    top: 5,
    right: 3,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: colors.paper,
    borderRadius: 9,
    backgroundColor: colors.accent,
  },
  headerBadgeText: {
    color: "#FFFFFF",
    fontFamily: fonts.semibold,
    fontSize: 10,
  },
  waitingRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowPressed: {
    opacity: 0.7,
  },
  waitingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  waitingText: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  loading: {
    paddingVertical: 48,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 22,
    paddingTop: 22,
    marginHorizontal: -6,
  },
  tile: {
    width: "25%",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 4,
  },
  tilePressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
  tileLabel: {
    maxWidth: "100%",
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: tightTracking(12),
  },
  empty: {
    gap: 12,
    paddingTop: 56,
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: tightTracking(24),
  },
  emptyBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: tightTracking(15),
  },
  command: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: "#F2F1ED",
  },
  commandText: {
    color: colors.ink,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 17,
  },
});
