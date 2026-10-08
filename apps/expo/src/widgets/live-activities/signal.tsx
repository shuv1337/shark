import { Button, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  activityBackgroundTint,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  kerning,
  lineLimit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityLayout } from "expo-widgets";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./types";

export function SignalLiveActivityStyle(
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
          buttonBorderShape("roundedRectangle", 8),
          controlSize("regular"),
          tint("#248A3D"),
          frame({ height: 46, maxWidth: Infinity }),
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
          buttonBorderShape("roundedRectangle", 8),
          controlSize("regular"),
          tint("#FF453A"),
          frame({ height: 46, maxWidth: Infinity }),
        ],
      } as Parameters<typeof Button>[0] & Record<string, unknown>)
    : undefined;
  const actions =
    canRespond && interaction && primaryButtonProps && secondaryButtonProps ? (
      <HStack spacing={9} modifiers={[frame({ maxWidth: Infinity })]}>
        <Button {...primaryButtonProps}>
          <Text
            modifiers={[
              font({ size: 13, weight: "semibold" }),
              foregroundStyle("#EAFBEF"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.primaryLabel}
          </Text>
        </Button>
        <Button {...secondaryButtonProps}>
          <Text
            modifiers={[
              font({ size: 13, weight: "semibold" }),
              foregroundStyle("#FF6961"),
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
      alignment="leading"
      spacing={9}
      modifiers={[padding({ horizontal: 16, vertical: 13 }), activityBackgroundTint("#141518")]}
    >
      <HStack spacing={7}>
        <Image systemName="shield.lefthalf.filled" color="#7D8087" size={13} />
        <Text
          modifiers={[
            font({ textStyle: "caption", weight: "semibold" }),
            kerning(0.6),
            foregroundStyle("#7D8087"),
          ]}
        >
          Guarded action
        </Text>
        <Spacer />
      </HStack>
      <Text
        modifiers={[
          font({ textStyle: "subheadline", weight: "medium" }),
          foregroundStyle("#F2F3F5"),
          lineLimit(2),
        ]}
      >
        {prompt}
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
