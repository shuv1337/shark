import { INBOX_FILTERS, type InboxFilter, type InboxItemDto } from "@hark/contracts";
import * as Notifications from "expo-notifications";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomNav } from "../src/components/bottom-nav";
import { api } from "../src/lib/api";
import { useSession } from "../src/lib/auth";
import {
  isSimulatorPreview,
  previewInboxItems,
  previewItemsForFilter,
} from "../src/lib/inbox-preview";
import { DEVICE_ID_KEY } from "../src/lib/interactions";
import { colors, fonts, tightTracking } from "../src/lib/theme";

const filterLabels: Record<InboxFilter, string> = {
  all: "All",
  needs_action: "Needs action",
  active: "Active",
  failed: "Failed",
  notifications: "Notifications",
};

export default function InboxScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [deviceReady, setDeviceReady] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [items, setItems] = useState<InboxItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSimulatorPreview) {
      setDeviceReady(true);
      return;
    }
    void SecureStore.getItemAsync(DEVICE_ID_KEY).then((id) => setDeviceReady(Boolean(id)));
  }, []);

  const load = useCallback(
    async (cursor?: string | null) => {
      if (isSimulatorPreview) {
        setItems(previewItemsForFilter(filter));
        setNextCursor(null);
        setUnresolvedCount(previewInboxItems.filter((item) => item.needsAction).length);
        setError(null);
        return;
      }
      const result = await api.listInbox(filter, cursor);
      setItems((current) => (cursor ? [...current, ...result.items] : result.items));
      setNextCursor(result.nextCursor);
      setUnresolvedCount(result.unresolvedCount);
      void Notifications.setBadgeCountAsync(result.unresolvedCount).catch(() => {});
      setError(null);
    },
    [filter],
  );

  useFocusEffect(
    useCallback(() => {
      if ((!session && !isSimulatorPreview) || !deviceReady) return;
      setLoading(true);
      void load()
        .catch((reason) =>
          setError(reason instanceof Error ? reason.message : "Could not load inbox"),
        )
        .finally(() => setLoading(false));
    }, [deviceReady, load, session]),
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      if ((session || isSimulatorPreview) && deviceReady) void load().catch(() => {});
    });
    return () => subscription.remove();
  }, [deviceReady, load, session]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load(nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  if (!isPending && !session && !isSimulatorPreview) return <Redirect href="/" />;
  if (deviceReady === false) return <Redirect href="/home" />;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>SHark</Text>
          <Text style={styles.title}>Inbox</Text>
        </View>
        {unresolvedCount > 0 ? (
          <View style={styles.actionCount}>
            <Text style={styles.actionCountText}>{unresolvedCount} waiting</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.filters}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {INBOX_FILTERS.map((value) => {
            const selected = value === filter;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={value}
                onPress={() => setFilter(value)}
                style={[styles.filter, selected && styles.filterSelected]}
              >
                <Text style={[styles.filterText, selected && styles.filterTextSelected]}>
                  {filterLabels[value]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
      >
        {loading ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}
        {!loading && error ? <Text style={styles.empty}>{error}</Text> : null}
        {!loading && !error && items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <SymbolView name="tray" size={30} tintColor={colors.soft} />
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.empty}>New notifications and activity will stay here.</Text>
          </View>
        ) : null}
        {items.map((item) => (
          <InboxRow
            item={item}
            key={item.id}
            onPress={() => router.push({ pathname: "/inbox-detail", params: { id: item.id } })}
          />
        ))}
        {nextCursor ? (
          <Pressable
            accessibilityRole="button"
            disabled={loadingMore}
            onPress={() => void loadMore()}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          >
            {loadingMore ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.moreText}>Load older</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
      <BottomNav />
    </SafeAreaView>
  );
}

function InboxRow({ item, onPress }: { item: InboxItemDto; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatarWrap}>
        {item.sourceImageUrl ? (
          <Image source={{ uri: item.sourceImageUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarText}>{item.sourceName.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        {!item.readAt ? <View style={styles.unreadDot} /> : null}
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {item.title}
          </Text>
          <Text style={styles.time}>{formatTime(item.occurredAt)}</Text>
        </View>
        <Text numberOfLines={1} style={styles.meta}>
          {item.sourceName} · {kindLabel(item.kind)}
        </Text>
        <Text numberOfLines={2} style={styles.body}>
          {item.body}
        </Text>
        <View style={styles.stateLine}>
          <View style={[styles.stateDot, stateDot(item)]} />
          <Text style={styles.state}>
            {item.needsAction ? "Needs action" : (item.result ?? item.status)}
          </Text>
        </View>
      </View>
      <SymbolView name="chevron.right" size={12} tintColor={colors.soft} weight="semibold" />
    </Pressable>
  );
}

function kindLabel(kind: InboxItemDto["kind"]) {
  if (kind === "live_activity") return "Live Activity";
  if (kind === "interaction") return "Interaction";
  return "Notification";
}

function formatTime(value: string) {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function stateDot(item: InboxItemDto) {
  if (item.needsAction) return { backgroundColor: colors.warning };
  if (["failed", "no_devices"].includes(item.status)) return { backgroundColor: colors.danger };
  if (["active", "starting", "partial"].includes(item.status))
    return { backgroundColor: colors.accent };
  return { backgroundColor: colors.soft };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
  },
  eyebrow: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 11,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 2,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 30,
    letterSpacing: tightTracking(30),
  },
  actionCount: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
  },
  actionCountText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 11 },
  filters: {
    minHeight: 46,
    paddingLeft: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  filter: { marginRight: 7, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 16 },
  filterSelected: { backgroundColor: colors.accentSoft },
  filterText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12 },
  filterTextSelected: { color: colors.accent },
  list: { paddingHorizontal: 20, paddingBottom: 28 },
  loader: { paddingVertical: 40 },
  row: {
    minHeight: 105,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: { opacity: 0.62 },
  avatarWrap: { alignSelf: "flex-start", marginTop: 2 },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  avatarText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 13 },
  unreadDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.paper,
    backgroundColor: colors.accent,
  },
  rowCopy: { minWidth: 0, flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  rowTitle: { minWidth: 0, flex: 1, color: colors.ink, fontFamily: fonts.semibold, fontSize: 14 },
  time: { color: colors.soft, fontFamily: fonts.regular, fontSize: 10 },
  meta: { marginTop: 2, color: colors.soft, fontFamily: fonts.regular, fontSize: 11 },
  body: {
    marginTop: 5,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  stateLine: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  state: {
    color: colors.soft,
    fontFamily: fonts.medium,
    fontSize: 10,
    textTransform: "capitalize",
  },
  emptyWrap: { alignItems: "center", paddingTop: 84 },
  emptyTitle: { marginTop: 14, color: colors.ink, fontFamily: fonts.semibold, fontSize: 18 },
  empty: {
    marginTop: 6,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: "center",
  },
  more: { minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 14 },
  moreText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 13 },
});
