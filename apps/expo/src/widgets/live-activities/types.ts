import type { LiveActivityProps } from "@hark/contracts";
import type { LiveActivityEnvironment } from "expo-widgets";

export type HarkLiveActivityProps = LiveActivityProps & {
  labInteractionPreview?: boolean;
};

export type HarkLiveActivityEnvironment = LiveActivityEnvironment & {
  harkInteractionId?: string;
  harkInteractionCredential?: string;
  harkInteractionDeviceId?: string;
  harkInteractionDeliveryId?: string;
};
