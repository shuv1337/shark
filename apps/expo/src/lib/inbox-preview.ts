import type { InboxDetailDto, InboxFilter, InboxItemDto } from "@hark/contracts";
import * as Device from "expo-device";

export const isSimulatorPreview = typeof __DEV__ !== "undefined" && __DEV__ && !Device.isDevice;

const now = Date.now();
const isoMinutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const previewInboxItems: InboxItemDto[] = [
  {
    id: "preview-approval",
    kind: "interaction",
    sourceName: "Deployments",
    sourceImageUrl: null,
    title: "Production deploy needs approval",
    body: "Release 2.4.0 passed every check and is waiting for your decision.",
    imageUrl: null,
    url: null,
    status: "pending",
    result: null,
    accepted: 1,
    failed: 0,
    needsAction: true,
    readAt: null,
    occurredAt: isoMinutesAgo(3),
    updatedAt: isoMinutesAgo(2),
    action: {
      interactionId: "preview-interaction",
      kind: "approval",
      choices: ["approve", "deny"],
      actionDigest: "preview",
      primaryLabel: "Approve",
      secondaryLabel: "Deny",
      expiresAt: isoMinutesAgo(-57),
    },
  },
  {
    id: "preview-live",
    kind: "live_activity",
    sourceName: "Build pipeline",
    sourceImageUrl: null,
    title: "iOS release build",
    body: "Archive uploaded. App Store processing is underway.",
    imageUrl: null,
    url: null,
    status: "active",
    result: "Processing",
    accepted: 1,
    failed: 0,
    needsAction: false,
    readAt: null,
    occurredAt: isoMinutesAgo(24),
    updatedAt: isoMinutesAgo(8),
    action: null,
  },
  {
    id: "preview-rich",
    kind: "notification",
    sourceName: "GitHub",
    sourceImageUrl: null,
    title: "Pull request ready for review",
    body: "Durable notification history is ready. Open the link to inspect the changes.",
    imageUrl: null,
    url: "https://github.com/",
    status: "accepted",
    result: "Delivered to 2 devices",
    accepted: 2,
    failed: 0,
    needsAction: false,
    readAt: isoMinutesAgo(40),
    occurredAt: isoMinutesAgo(41),
    updatedAt: isoMinutesAgo(40),
    action: null,
  },
  {
    id: "preview-failed",
    kind: "notification",
    sourceName: "Production monitor",
    sourceImageUrl: null,
    title: "Notification delivery failed",
    body: "The event is preserved here even though no registered device accepted the push.",
    imageUrl: null,
    url: null,
    status: "failed",
    result: "No registered devices",
    accepted: 0,
    failed: 1,
    needsAction: false,
    readAt: isoMinutesAgo(75),
    occurredAt: isoMinutesAgo(76),
    updatedAt: isoMinutesAgo(75),
    action: null,
  },
];

export function previewItemsForFilter(filter: InboxFilter): InboxItemDto[] {
  if (filter === "needs_action") return previewInboxItems.filter((item) => item.needsAction);
  if (filter === "active")
    return previewInboxItems.filter((item) => ["active", "starting"].includes(item.status));
  if (filter === "failed")
    return previewInboxItems.filter((item) => ["failed", "no_devices"].includes(item.status));
  if (filter === "notifications")
    return previewInboxItems.filter((item) => item.kind === "notification");
  return previewInboxItems;
}

export const previewInboxDetail: InboxDetailDto = {
  item: previewInboxItems[0] as InboxItemDto,
  events: [
    {
      id: "preview-event-3",
      kind: "delivery_accepted",
      detail: "Accepted by 1 device",
      result: "Delivered",
      accepted: 1,
      failed: 0,
      occurredAt: isoMinutesAgo(2),
    },
    {
      id: "preview-event-2",
      kind: "interaction_started",
      detail: "Approval request is available in SHark and on supported notification surfaces.",
      result: "Waiting for response",
      accepted: 1,
      failed: 0,
      occurredAt: isoMinutesAgo(3),
    },
    {
      id: "preview-event-1",
      kind: "created",
      detail: "Created by Deployments",
      result: null,
      accepted: 0,
      failed: 0,
      occurredAt: isoMinutesAgo(4),
    },
  ],
};

export function previewInboxDetailForId(id: string): InboxDetailDto {
  const item = previewInboxItems.find((candidate) => candidate.id === id);
  if (!item || item.id === previewInboxDetail.item.id) return previewInboxDetail;
  return {
    item,
    events: [
      {
        id: `${item.id}:delivery`,
        kind: item.status === "failed" ? "delivery_failed" : "delivery_accepted",
        detail:
          item.status === "failed"
            ? "No registered device accepted this push."
            : `${item.accepted} device${item.accepted === 1 ? "" : "s"} accepted the push.`,
        result: item.result,
        accepted: item.accepted,
        failed: item.failed,
        occurredAt: item.updatedAt,
      },
      {
        id: `${item.id}:created`,
        kind: "created",
        detail: `Created by ${item.sourceName}`,
        result: null,
        accepted: 0,
        failed: 0,
        occurredAt: item.occurredAt,
      },
    ],
  };
}
