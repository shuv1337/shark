import { Button, Divider, HStack, Text, VStack } from "@expo/ui/swift-ui";
import {
  activityBackgroundTint,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityLayout } from "expo-widgets";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./types";

export function VerdictLiveActivityStyle(
  props: HarkLiveActivityProps,
  environment: HarkLiveActivityEnvironment,
  approval: LiveActivityLayout,
): LiveActivityLayout {
  "widget";
  const status = props.privacyMode === "private" ? "In progress" : props.status;
  const detail = props.privacyMode === "private" ? undefined : props.detail;
  const interaction = props.interaction;
  const prompt = interaction ? interaction.prompt : (detail ?? status);
  const previewInteraction = props.labInteractionPreview === true;
  const harkInteractionId =
    environment.harkInteractionId ??
    (previewInteraction && interaction ? interaction.id : undefined);
  const harkInteractionCredential =
    environment.harkInteractionCredential ?? (previewInteraction ? "preview" : undefined);
  const harkInteractionDeviceId =
    environment.harkInteractionDeviceId ?? (previewInteraction ? "lab-device" : undefined);
  const harkInteractionDeliveryId =
    environment.harkInteractionDeliveryId ?? (previewInteraction ? "lab-delivery" : undefined);
  const canRespond =
    interaction?.state === "pending" &&
    harkInteractionId !== undefined &&
    harkInteractionCredential !== undefined &&
    harkInteractionDeviceId !== undefined &&
    harkInteractionDeliveryId !== undefined;
  const primaryButtonProps = interaction
    ? ({
        target: interaction.primaryAction,
        harkInteractionId,
        harkInteractionCredential,
        harkInteractionDeviceId,
        harkInteractionDeliveryId,
        modifiers: [
          buttonStyle("borderedProminent"),
          buttonBorderShape("roundedRectangle", 10),
          controlSize("regular"),
          tint("#0A84FF"),
          frame({ height: 48, maxWidth: Infinity }),
        ],
      } as Parameters<typeof Button>[0] & Record<string, unknown>)
    : undefined;
  const secondaryButtonProps = interaction
    ? ({
        target: interaction.secondaryAction,
        role: "cancel",
        harkInteractionId,
        harkInteractionCredential,
        harkInteractionDeviceId,
        harkInteractionDeliveryId,
        modifiers: [
          buttonStyle("bordered"),
          buttonBorderShape("roundedRectangle", 10),
          controlSize("regular"),
          tint("#8E8E93"),
          frame({ height: 48, maxWidth: Infinity }),
        ],
      } as Parameters<typeof Button>[0] & Record<string, unknown>)
    : undefined;
  const actions =
    canRespond && interaction && primaryButtonProps && secondaryButtonProps ? (
      <HStack spacing={9} modifiers={[frame({ maxWidth: Infinity })]}>
        <Button {...primaryButtonProps}>
          <Text
            modifiers={[
              font({ size: 14, weight: "semibold" }),
              foregroundStyle("#FFFFFF"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.primaryLabel}
          </Text>
        </Button>
        <Button {...secondaryButtonProps}>
          <Text
            modifiers={[
              font({ size: 14, weight: "semibold" }),
              foregroundStyle("#EBEBF0"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.secondaryLabel}
          </Text>
        </Button>
      </HStack>
    ) : null;

  const banner = (
    <VStack
      alignment="center"
      spacing={8}
      modifiers={[padding({ horizontal: 16, vertical: 13 }), activityBackgroundTint("#1C1C1E")]}
    >
      <Text
        modifiers={[
          font({ textStyle: "footnote", weight: "semibold" }),
          foregroundStyle("#FFFFFF"),
        ]}
      >
        {"\u201CHark\u201D requests approval"}
      </Text>
      <Text
        modifiers={[font({ textStyle: "subheadline" }), foregroundStyle("#EBEBF5"), lineLimit(2)]}
      >
        {prompt}
      </Text>
      <Divider />
      {actions}
    </VStack>
  );

  return {
    banner,
    bannerSmall: approval.bannerSmall,
    compactLeading: approval.compactLeading,
    compactTrailing: approval.compactTrailing,
    minimal: approval.minimal,
    expandedLeading: approval.expandedLeading,
    expandedTrailing: approval.expandedTrailing,
    expandedBottom: approval.expandedBottom,
  };
}
