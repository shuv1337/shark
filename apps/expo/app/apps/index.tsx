import type { AppDto } from "@hark/contracts";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
import { isSimulatorPreview, previewApps } from "../../src/lib/inbox-preview";
import { colors, fonts, tightTracking } from "../../src/lib/theme";
import { cacheApps, cachedApp } from "../../src/lib/web-apps";

const ADD_APP_COMMAND = 'sharkctl apps create --name "My app" --url https://…';

export default function AppsScreen() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const [apps, setApps] = useState<AppDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Only the newest refresh may write state, so a slow older response never wins.
  const refreshSequence = useRef(0);

  const refresh = useCallback(async () => {
    const token = ++refreshSequence.current;
    if (isSimulatorPreview) {
      // Keep consent granted earlier in this preview session.
      const previewed = previewApps.map((app) => cachedApp(app.id) ?? app);
      cacheApps(previewed);
      setApps(previewed);
      setLoadError(false);
      return;
    }
    const result = await api.listApps();
    if (token !== refreshSequence.current) return;
    cacheApps(result.apps);
    setApps(result.apps);
    setLoadError(false);
  }, []);

  const ready = Boolean(session || isSimulatorPreview);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    void refresh()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(() => {});
    });
    return () => appStateSubscription.remove();
  }, [ready, refresh]);

  // Returning from an app or app info updates order and consent state.
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

  if (!sessionPending && !session && !isSimulatorPreview) return <Redirect href="/" />;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
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
        <View style={styles.header}>
          <Text style={styles.title}>Apps</Text>
          <Text style={styles.subtitle}>
            Web apps you registered, opened here already signed in with SHark.
          </Text>
        </View>

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
                : "Register any web app you run and open it here. Ask an agent, or run:"}
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
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: 24, paddingBottom: 32 },
  header: { minHeight: 64, justifyContent: "center", gap: 6, paddingTop: 12 },
  title: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 28,
    letterSpacing: tightTracking(28),
  },
  subtitle: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  loading: { paddingVertical: 48 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 22,
    paddingTop: 22,
    marginHorizontal: -6,
  },
  tile: { width: "25%", alignItems: "center", gap: 7, paddingHorizontal: 4 },
  tilePressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  tileLabel: {
    maxWidth: "100%",
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: tightTracking(12),
  },
  empty: { gap: 12, paddingTop: 40 },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: tightTracking(22),
  },
  emptyBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  command: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  commandText: { color: colors.ink, fontFamily: fonts.mono, fontSize: 12, lineHeight: 17 },
});
