import { Button, HStack, Spacer, Text, VStack } from "@expo/ui/swift-ui";
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

export function ShellLiveActivityStyle(
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
          buttonBorderShape("roundedRectangle", 4),
          controlSize("regular"),
          tint("#173D26"),
          frame({ height: 44, maxWidth: Infinity }),
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
          buttonBorderShape("roundedRectangle", 4),
          controlSize("regular"),
          tint("#4E5C52"),
          frame({ height: 44, maxWidth: Infinity }),
        ],
      } as Parameters<typeof Button>[0] & Record<string, unknown>)
    : undefined;
  const actions =
    canRespond && interaction && primaryButtonProps && secondaryButtonProps ? (
      <HStack spacing={9} modifiers={[frame({ maxWidth: Infinity })]}>
        <Button {...primaryButtonProps}>
          <Text
            modifiers={[
              font({ size: 12, weight: "bold", design: "monospaced" }),
              foregroundStyle("#3FDD78"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.primaryLabel.toLowerCase()} ⏎
          </Text>
        </Button>
        <Button {...secondaryButtonProps}>
          <Text
            modifiers={[
              font({ size: 12, weight: "bold", design: "monospaced" }),
              foregroundStyle("#8E9C92"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.secondaryLabel.toLowerCase()}
          </Text>
        </Button>
      </HStack>
    ) : null;

  const banner = (
    <VStack
      alignment="leading"
      spacing={9}
      modifiers={[padding({ horizontal: 14, vertical: 13 }), activityBackgroundTint("#0A0C0A")]}
    >
      <HStack alignment="top" spacing={7}>
        <Text
          modifiers={[
            font({ size: 13, weight: "semibold", design: "monospaced" }),
            foregroundStyle("#3FDD78"),
          ]}
        >
          $
        </Text>
        <Text
          modifiers={[
            font({ size: 13, design: "monospaced" }),
            foregroundStyle("#D7E4DA"),
            lineLimit(2),
          ]}
        >
          {prompt}
        </Text>
        <Spacer />
      </HStack>
      <Text
        modifiers={[
          font({ size: 11, design: "monospaced" }),
          foregroundStyle("#4E5C52"),
          lineLimit(1),
        ]}
      >
        # reply required to continue
      </Text>
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
