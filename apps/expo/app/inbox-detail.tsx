import type { InboxDetailDto } from "@hark/contracts";
import * as Notifications from "expo-notifications";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../src/lib/api";
import { isSimulatorPreview, previewInboxDetailForId } from "../src/lib/inbox-preview";
import { submitInboxInteraction } from "../src/lib/interactions";
import { colors, fonts, tightTracking } from "../src/lib/theme";

export default function InboxDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const [detail, setDetail] = useState<InboxDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [responding, setResponding] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      if (isSimulatorPreview && id.startsWith("preview-")) {
        setDetail(previewInboxDetailForId(id));
        setError(null);
        return;
      }
      const value = await api.getInboxItem(id);
      setDetail(value);
      setError(null);
      await api.markInboxItemRead(id).catch(() => {});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load notification");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (action: "approve" | "deny" | "yes" | "no" | "reply") => {
    const available = detail?.item.action;
    if (!available || responding) return;
    if (action === "reply" && !reply.trim()) return;
    setResponding(true);
    try {
      if (isSimulatorPreview && id.startsWith("preview-")) {
        setDetail((current) =>
          current
            ? {
                ...current,
                item: {
                  ...current.item,
                  status: "completed",
                  result: action === "approve" ? "Approved" : action === "deny" ? "Denied" : action,
                  needsAction: false,
                  action: null,
                },
              }
            : current,
        );
        return;
      }
      await submitInboxInteraction(
        available.interactionId,
        action === "reply"
          ? { action, response: reply.trim(), actionDigest: available.actionDigest }
          : { action, actionDigest: available.actionDigest },
      );
      setReply("");
      await load();
      const summary = await api.listInbox("needs_action", null, 1);
      void Notifications.setBadgeCountAsync(summary.unresolvedCount).catch(() => {});
    } catch (reason) {
      Alert.alert(
        "Could not save response",
        reason instanceof Error ? reason.message : "Please try again.",
      );
    } finally {
      setResponding(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <SymbolView name="chevron.left" size={18} tintColor={colors.ink} weight="semibold" />
        </Pressable>
        <Text style={styles.headerTitle}>Notification</Text>
        <View style={styles.headerSpacer} />
      </View>
      {!detail && !error ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {detail ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.sourceRow}>
            {detail.item.sourceImageUrl ? (
              <Image source={{ uri: detail.item.sourceImageUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>
                  {detail.item.sourceName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View>
              <Text style={styles.source}>{detail.item.sourceName}</Text>
              <Text style={styles.time}>
                {new Date(detail.item.occurredAt).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          </View>
          <Text selectable style={styles.title}>
            {detail.item.title}
          </Text>
          <Text selectable style={styles.body}>
            {detail.item.body}
          </Text>
          {detail.item.imageUrl ? (
            <Image resizeMode="cover" source={{ uri: detail.item.imageUrl }} style={styles.hero} />
          ) : null}
          {detail.item.url ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(detail.item.url ?? "")}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
            >
              <Text style={styles.linkText}>Open link</Text>
              <SymbolView name="arrow.up.right" size={13} tintColor={colors.accent} />
            </Pressable>
          ) : null}
          {detail.item.action ? (
            <ActionPanel
              action={detail.item.action}
              reply={reply}
              responding={responding}
              onReply={setReply}
              onRespond={(action) => void respond(action)}
            />
          ) : (
            <View style={styles.resultCard}>
              <Text style={styles.resultLabel}>Status</Text>
              <Text style={styles.resultValue}>{detail.item.result ?? detail.item.status}</Text>
              <Text style={styles.resultMeta}>
                Accepted {detail.item.accepted}
                {detail.item.failed ? ` · Failed ${detail.item.failed}` : ""}
              </Text>
            </View>
          )}
          <Text style={styles.timelineTitle}>Timeline</Text>
          {detail.events.map((event, index) => (
            <View style={styles.timelineRow} key={event.id}>
              <View style={styles.timelineRail}>
                <View style={styles.timelineDot} />
                {index < detail.events.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineCopy}>
                <Text style={styles.timelineResult}>
                  {event.result ?? timelineLabel(event.kind)}
                </Text>
                {event.detail ? <Text style={styles.timelineDetail}>{event.detail}</Text> : null}
                <Text style={styles.timelineTime}>
                  {new Date(event.occurredAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

function ActionPanel({
  action,
  reply,
  responding,
  onReply,
  onRespond,
}: {
  action: NonNullable<InboxDetailDto["item"]["action"]>;
  reply: string;
  responding: boolean;
  onReply: (value: string) => void;
  onRespond: (action: "approve" | "deny" | "yes" | "no" | "reply") => void;
}) {
  if (action.kind === "reply") {
    return (
      <View style={styles.actionPanel}>
        <Text style={styles.actionHeading}>Reply</Text>
        <TextInput
          multiline
          onChangeText={onReply}
          placeholder="Write a response"
          placeholderTextColor={colors.soft}
          style={styles.input}
          value={reply}
        />
        <Pressable
          disabled={!reply.trim() || responding}
          onPress={() => onRespond("reply")}
          style={({ pressed }) => [
            styles.primaryButton,
            (!reply.trim() || responding || pressed) && styles.disabled,
          ]}
        >
          <Text style={styles.primaryText}>{responding ? "Sending…" : "Send reply"}</Text>
        </Pressable>
      </View>
    );
  }
  const positive = action.kind === "approval" ? "approve" : "yes";
  const negative = action.kind === "approval" ? "deny" : "no";
  return (
    <View style={styles.actionPanel}>
      <Text style={styles.actionHeading}>Needs your response</Text>
      <View style={styles.actionRow}>
        <Pressable
          disabled={responding}
          onPress={() => onRespond(positive)}
          style={({ pressed }) => [
            styles.primaryButton,
            (responding || pressed) && styles.disabled,
          ]}
        >
          <Text style={styles.primaryText}>
            {action.primaryLabel ?? (action.kind === "approval" ? "Approve" : "Yes")}
          </Text>
        </Pressable>
        <Pressable
          disabled={responding}
          onPress={() => onRespond(negative)}
          style={({ pressed }) => [
            styles.secondaryAction,
            (responding || pressed) && styles.disabled,
          ]}
        >
          <Text style={styles.secondaryActionText}>
            {action.secondaryLabel ?? (action.kind === "approval" ? "Deny" : "No")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function timelineLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  pressed: { opacity: 0.62 },
  headerTitle: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 16 },
  headerSpacer: { width: 36 },
  loader: { marginTop: 60 },
  error: {
    padding: 32,
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlign: "center",
  },
  content: { paddingHorizontal: 24, paddingTop: 26, paddingBottom: 60 },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  avatarText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 14 },
  source: { color: colors.ink, fontFamily: fonts.medium, fontSize: 14 },
  time: { marginTop: 2, color: colors.soft, fontFamily: fonts.regular, fontSize: 11 },
  title: {
    marginTop: 28,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 27,
    lineHeight: 33,
    letterSpacing: tightTracking(27),
  },
  body: {
    marginTop: 15,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 17,
    lineHeight: 27,
  },
  hero: {
    width: "100%",
    height: 210,
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  linkButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
  },
  linkText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 13 },
  resultCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  resultLabel: {
    color: colors.soft,
    fontFamily: fonts.medium,
    fontSize: 10,
    textTransform: "uppercase",
  },
  resultValue: {
    marginTop: 5,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 16,
    textTransform: "capitalize",
  },
  resultMeta: { marginTop: 4, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  actionPanel: {
    marginTop: 24,
    padding: 16,
    gap: 12,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  actionHeading: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 15 },
  actionRow: { flexDirection: "row", gap: 10 },
  primaryButton: {
    minHeight: 46,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.accent,
  },
  primaryText: { color: colors.accentForeground, fontFamily: fonts.semibold, fontSize: 14 },
  secondaryAction: {
    minHeight: 46,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
  },
  secondaryActionText: { color: colors.accent, fontFamily: fonts.semibold, fontSize: 14 },
  disabled: { opacity: 0.5 },
  input: {
    minHeight: 90,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 12,
    color: colors.ink,
    backgroundColor: colors.paper,
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlignVertical: "top",
  },
  timelineTitle: {
    marginTop: 34,
    marginBottom: 18,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 18,
  },
  timelineRow: { flexDirection: "row", minHeight: 68 },
  timelineRail: { width: 20, alignItems: "center" },
  timelineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginTop: 4,
    backgroundColor: colors.accent,
  },
  timelineLine: { width: 1, flex: 1, marginVertical: 4, backgroundColor: colors.line },
  timelineCopy: { flex: 1, paddingLeft: 10, paddingBottom: 18 },
  timelineResult: { color: colors.ink, fontFamily: fonts.medium, fontSize: 13 },
  timelineDetail: {
    marginTop: 3,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  timelineTime: { marginTop: 4, color: colors.soft, fontFamily: fonts.regular, fontSize: 10 },
});
