import { Circle, HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
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
  shadow,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityLayout } from "expo-widgets";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./types";

export function TerminalLiveActivityStyle(
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
  const statusLower = status.toLowerCase();
  const comment = detail === undefined ? undefined : `# ${detail}`;
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
      spacing={7}
      modifiers={[
        padding({ horizontal: 16, vertical: 13 }),
        activityBackgroundTint("#0C1119"),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      <HStack spacing={8}>
        <Image systemName={symbol} color={accent} size={16} />
        <Text
          modifiers={[
            font({ size: 13, weight: "semibold", design: "monospaced" }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {title}
        </Text>
        <Spacer />
        <Circle
          modifiers={[
            frame({ width: 7, height: 7 }),
            foregroundStyle(accent),
            shadow({ radius: 4, color: accent }),
          ]}
        />
      </HStack>
      <HStack spacing={6}>
        <Text
          modifiers={[
            font({ size: 13, weight: "semibold", design: "monospaced" }),
            foregroundStyle(accent),
          ]}
        >
          {"❯"}
        </Text>
        <Text
          modifiers={[
            font({ size: 13, design: "monospaced" }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {statusLower}
        </Text>
        <Spacer />
      </HStack>
      {comment ? (
        <Text
          modifiers={[
            font({ size: 11, design: "monospaced" }),
            foregroundStyle(secondary),
            lineLimit(1),
          ]}
        >
          {comment}
        </Text>
      ) : null}
      {props.progress !== undefined ? (
        <HStack spacing={8}>
          <ProgressView
            value={props.progress}
            modifiers={[progressViewStyle("linear"), tint(accent), frame({ maxWidth: Infinity })]}
          />
          <Text
            modifiers={[
              font({ size: 11, design: "monospaced" }),
              monospacedDigit(),
              foregroundStyle(accent),
            ]}
          >
            {percentage}
          </Text>
        </HStack>
      ) : null}
    </VStack>
  );

  const bannerSmall = (
    <HStack spacing={6} modifiers={[padding({ all: 10 }), accessibilityElement("combine")]}>
      <Text
        modifiers={[
          font({ size: 12, weight: "semibold", design: "monospaced" }),
          foregroundStyle(accent),
        ]}
      >
        {"❯"}
      </Text>
      <Text
        modifiers={[
          font({ size: 12, design: "monospaced" }),
          foregroundStyle(primary),
          lineLimit(1),
        ]}
      >
        {statusLower}
      </Text>
      <Spacer />
      {percentage ? (
        <Text
          modifiers={[
            font({ size: 12, design: "monospaced" }),
            monospacedDigit(),
            foregroundStyle(accent),
          ]}
        >
          {percentage}
        </Text>
      ) : null}
    </HStack>
  );

  const compactTrailing = (
    <Text
      modifiers={[
        font({ size: 12, weight: "semibold", design: "monospaced" }),
        monospacedDigit(),
        foregroundStyle(accent),
        lineLimit(1),
      ]}
    >
      {percentage ?? "❯_"}
    </Text>
  );

  const expandedLeading = (
    <HStack spacing={7} modifiers={[padding({ leading: 4 })]}>
      <Image systemName={symbol} color={accent} size={16} />
      <Text
        modifiers={[
          font({ size: 13, weight: "semibold", design: "monospaced" }),
          foregroundStyle(primary),
          lineLimit(1),
        ]}
      >
        {title}
      </Text>
    </HStack>
  );

  const expandedTrailing = percentage ? (
    <Text
      modifiers={[
        padding({ trailing: 4 }),
        font({ size: 12, weight: "semibold", design: "monospaced" }),
        monospacedDigit(),
        foregroundStyle(accent),
      ]}
    >
      {percentage}
    </Text>
  ) : undefined;

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
      <HStack spacing={6}>
        <Text
          modifiers={[
            font({ size: 13, weight: "semibold", design: "monospaced" }),
            foregroundStyle(accent),
          ]}
        >
          {"❯"}
        </Text>
        <Text
          modifiers={[
            font({ size: 13, design: "monospaced" }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {statusLower}
        </Text>
        <Spacer />
      </HStack>
      {comment ? (
        <Text
          modifiers={[
            font({ size: 11, design: "monospaced" }),
            foregroundStyle(secondary),
            lineLimit(1),
          ]}
        >
          {comment}
        </Text>
      ) : null}
      {linearBar}
    </VStack>
  );

  return {
    banner,
    bannerSmall,
    compactLeading: standard.compactLeading,
    compactTrailing,
    minimal: standard.minimal,
    expandedLeading,
    expandedTrailing,
    expandedBottom,
  };
}
