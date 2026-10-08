import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  progressViewStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityLayout } from "expo-widgets";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./types";

export function HeroLiveActivityStyle(
  props: HarkLiveActivityProps,
  _environment: HarkLiveActivityEnvironment,
  standard: LiveActivityLayout,
): LiveActivityLayout {
  "widget";
  const accent = props.accentColor ?? "#D35C46";
  const primary = "#E7ECF3";
  const secondary = "#B9C3D1";
  const title = props.privacyMode === "private" ? "Agent task" : props.title;
  const status = props.privacyMode === "private" ? "In progress" : props.status;
  const detail = props.privacyMode === "private" ? undefined : props.detail;
  const symbol =
    props.symbol === "code"
      ? "chevron.left.forwardslash.chevron.right"
      : props.symbol === "build"
        ? "gearshape.2.fill"
        : props.symbol === "success"
          ? "checkmark.circle.fill"
          : props.symbol === "warning"
            ? "exclamationmark.triangle.fill"
            : "terminal.fill";
  const percentage =
    props.progress === undefined ? undefined : `${Math.round(props.progress * 100)}%`;
  const a11ySummary = `${title}, ${status}${percentage ? `, ${percentage}` : ""}`;
  const linearBar =
    props.progress !== undefined ? (
      <ProgressView
        value={props.progress}
        modifiers={[progressViewStyle("linear"), tint(accent), frame({ maxWidth: Infinity })]}
      />
    ) : null;

  const banner = (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[
        activityBackgroundTint("#0C1119"),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      <VStack
        alignment="leading"
        spacing={3}
        modifiers={[padding({ top: 13, leading: 16, trailing: 16, bottom: 12 })]}
      >
        <HStack spacing={8}>
          <Image systemName={symbol} color={accent} size={15} />
          <Spacer />
          {percentage ? (
            <Text
              modifiers={[
                font({ size: 13, weight: "semibold" }),
                monospacedDigit(),
                foregroundStyle(accent),
              ]}
            >
              {percentage}
            </Text>
          ) : null}
        </HStack>
        <Text
          modifiers={[font({ size: 22, weight: "bold" }), foregroundStyle(primary), lineLimit(1)]}
        >
          {status}
        </Text>
        {detail ? (
          <Text
            modifiers={[font({ textStyle: "footnote" }), foregroundStyle(secondary), lineLimit(1)]}
          >
            {detail}
          </Text>
        ) : null}
      </VStack>
      {linearBar}
    </VStack>
  );

  const expandedLeading = (
    <HStack spacing={7} modifiers={[padding({ leading: 4 })]}>
      <Image systemName={symbol} color={accent} size={14} />
    </HStack>
  );

  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={7}
      modifiers={[
        padding({ horizontal: 4, vertical: 2 }),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      <Text
        modifiers={[font({ size: 20, weight: "bold" }), foregroundStyle(primary), lineLimit(1)]}
      >
        {status}
      </Text>
      {linearBar}
    </VStack>
  );

  return {
    banner,
    bannerSmall: standard.bannerSmall,
    compactLeading: standard.compactLeading,
    compactTrailing: standard.compactTrailing,
    minimal: standard.minimal,
    expandedLeading,
    expandedTrailing: standard.expandedTrailing,
    expandedBottom,
  };
}
