import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { clearNotificationDetail, getNotificationDetail } from "../src/lib/notification-detail";
import { colors, fonts, tightTracking } from "../src/lib/theme";

export default function NotificationDetailScreen() {
  const router = useRouter();
  const detail = getNotificationDetail();

  const close = () => {
    clearNotificationDetail();
    router.back();
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          hitSlop={12}
          onPress={close}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <SymbolView name="chevron.left" size={18} tintColor={colors.ink} weight="semibold" />
        </Pressable>
        <Text style={styles.headerTitle}>Notification</Text>
        <View style={styles.headerSpacer} />
      </View>

      {detail ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.sourceRow}>
            {detail.avatarUrl ? (
              <Image source={{ uri: detail.avatarUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>
                  {(detail.sourceName ?? detail.title).slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.sourceCopy}>
              <Text style={styles.source}>{detail.sourceName ?? "SHark"}</Text>
              <Text style={styles.time}>
                {new Date(detail.receivedAt).toLocaleString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </View>
          </View>
          <Text selectable style={styles.title}>
            {detail.title}
          </Text>
          <Text selectable style={styles.body}>
            {detail.body}
          </Text>
        </ScrollView>
      ) : (
        <View style={styles.missing}>
          <Text style={styles.missingTitle}>Notification unavailable</Text>
          <Text style={styles.missingBody}>
            Return to Recent Activity to view delivered events.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  header: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  back: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.65 },
  headerTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 16,
    letterSpacing: tightTracking(16),
  },
  headerSpacer: { width: 36 },
  content: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 56 },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: colors.accentSoft,
  },
  avatarFallbackText: {
    color: colors.accent,
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  sourceCopy: { gap: 2 },
  source: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  time: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  title: {
    marginTop: 28,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: tightTracking(26),
  },
  body: {
    marginTop: 16,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 17,
    lineHeight: 27,
    letterSpacing: tightTracking(17),
  },
  missing: { flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  missingTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 20,
    textAlign: "center",
  },
  missingBody: {
    marginTop: 8,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
