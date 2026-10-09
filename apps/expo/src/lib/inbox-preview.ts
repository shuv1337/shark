import type {
  AppDto,
  InboxDetailDto,
  InboxFilter,
  InboxItemDto,
  OncallGroupDto,
  OncallPageDto,
  TeamDto,
  TeamInviteDto,
  TeamInvitePreviewDto,
  TeamMemberDto,
} from "@hark/contracts";
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

export const PREVIEW_TEAM_ID = "team_previewacme01";
const previewTeamSummary = { id: PREVIEW_TEAM_ID, name: "Acme" };

/** The simulator's signed-in person, used to mark "you" in team previews. */
export const previewViewer = { userId: "user_preview_ryan", name: "Ryan Vogel" };

function previewTeamApp(
  id: string,
  name: string,
  url: string,
  addedBy: string,
  consented: boolean,
): AppDto {
  return {
    id,
    name,
    origin: new URL(url).origin,
    iconUrl: null,
    url,
    shareName: true,
    shareEmail: false,
    consentedAt: consented ? isoMinutesAgo(60 * 24 * 30) : null,
    lastOpenedAt: consented ? isoMinutesAgo(90) : null,
    createdBy: null,
    createdAt: isoMinutesAgo(60 * 24 * 30),
    updatedAt: isoMinutesAgo(60 * 24 * 30),
    projectId: null,
    projectName: null,
    team: previewTeamSummary,
    addedBy,
  };
}

export const previewApps: AppDto[] = [
  {
    id: "app_previewboard",
    name: "Sharkboard",
    origin: "https://shark.shuv.dev",
    iconUrl: null,
    url: "https://shark.shuv.dev/board",
    projectId: null,
    projectName: null,
    shareName: true,
    shareEmail: false,
    consentedAt: null,
    lastOpenedAt: null,
    createdBy: "Firstmate (box)",
    team: null,
    addedBy: null,
    createdAt: isoMinutesAgo(600),
    updatedAt: isoMinutesAgo(600),
  },
  previewTeamApp("app_previewstatus", "Status", "https://status.example.com/", "Maya Chen", true),
];

export const previewTeams: TeamDto[] = [
  {
    ...previewTeamSummary,
    role: "owner",
    memberCount: 4,
    appCount: 3,
    oncallGroupCount: 1,
    seats: { used: 4, available: 5, billable: 4 },
    plan: "team",
    createdAt: new Date(now - 40 * 86_400_000).toISOString(),
  },
];

const person = (userId: string, name: string) => ({ userId, name, image: null });
const ryan = person(previewViewer.userId, previewViewer.name);
const maya = person("user_preview_maya", "Maya Chen");
const sam = person("user_preview_sam", "Sam Ortiz");
const priya = person("user_preview_priya", "Priya Nair");

export const previewTeamMembers: TeamMemberDto[] = [
  { ...ryan, email: "ryan@acme.dev", role: "owner", joinedAt: previewTeams[0]?.createdAt ?? "" },
  {
    ...maya,
    email: "maya@acme.dev",
    role: "admin",
    joinedAt: new Date(now - 30 * 86_400_000).toISOString(),
  },
  {
    ...sam,
    email: "sam@acme.dev",
    role: "member",
    joinedAt: new Date(now - 12 * 86_400_000).toISOString(),
  },
  {
    ...priya,
    email: "priya@acme.dev",
    role: "member",
    joinedAt: new Date(now - 2 * 86_400_000).toISOString(),
  },
];

export const previewTeamInvites: TeamInviteDto[] = [
  {
    id: "inv_preview01",
    teamId: PREVIEW_TEAM_ID,
    email: "jordan@acme.dev",
    role: "member",
    invitedBy: "Ryan Vogel",
    expiresAt: new Date(now + 6 * 86_400_000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(now - 86_400_000).toISOString(),
  },
];

export const previewInvite: TeamInvitePreviewDto = {
  teamName: "Acme",
  invitedBy: "Maya Chen",
  role: "member",
  memberCount: 4,
  expiresAt: new Date(now + 6 * 86_400_000).toISOString(),
};

/** Handoffs every Monday at 9:00, local time, so the strip reads "until Mon 9:00 AM". */
function nextMondayNine(from: number): Date {
  const date = new Date(from);
  date.setHours(9, 0, 0, 0);
  const days = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + days);
  return date;
}

const handoff = nextMondayNine(now);
/** Handoff `weeks` from the next one, at 9:00 local time across DST changes. */
function handoffAt(weeks: number): number {
  const date = new Date(handoff);
  date.setDate(date.getDate() + weeks * 7);
  return date.getTime();
}
const shift = (who: typeof ryan, startsAt: number, endsAt: number) => ({
  person: who,
  startsAt: new Date(startsAt).toISOString(),
  endsAt: new Date(endsAt).toISOString(),
  override: false,
});

export const previewOncallGroups: OncallGroupDto[] = [
  {
    id: "ocg_previewplatform",
    teamId: PREVIEW_TEAM_ID,
    name: "Platform",
    rotation: {
      members: [ryan, maya, sam],
      period: "weekly",
      handoffAt: "09:00",
      timezone: "America/New_York",
      startsAt: new Date(handoffAt(-5)).toISOString(),
    },
    escalation: [
      { afterMinutes: 5, target: "next" },
      { afterMinutes: 10, target: "group" },
    ],
    current: shift(ryan, handoffAt(-1), handoffAt(0)),
    upcoming: [
      shift(ryan, handoffAt(-1), handoffAt(0)),
      shift(maya, handoffAt(0), handoffAt(1)),
      shift(sam, handoffAt(1), handoffAt(2)),
      shift(ryan, handoffAt(2), handoffAt(3)),
    ],
    openPageCount: 2,
    createdAt: new Date(now - 30 * 86_400_000).toISOString(),
    updatedAt: new Date(now - 86_400_000).toISOString(),
  },
];

function previewPage(
  id: string,
  title: string,
  body: string,
  minutesAgo: number,
  extra: Partial<OncallPageDto> = {},
): OncallPageDto {
  return {
    id,
    groupId: "ocg_previewplatform",
    groupName: "Platform",
    teamId: PREVIEW_TEAM_ID,
    title,
    body,
    url: null,
    app: null,
    status: "triggered",
    dedupKey: null,
    repeatCount: 0,
    notified: [ryan],
    escalationStep: 0,
    nextEscalationAt: new Date(now + 4 * 60_000).toISOString(),
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    source: "Uptime monitor",
    createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
    ...extra,
  };
}

export const previewPages: OncallPageDto[] = [
  previewPage(
    "page_previewapi5xx",
    "API error rate above 5%",
    "api-prod is returning 5xx on 7.2% of requests for the last 5 minutes. p95 latency 2.4s.",
    3,
    {
      app: {
        id: "app_previewstatus",
        name: "Status",
        origin: "https://status.example.com",
        iconUrl: null,
      },
      url: "https://status.example.com/incidents/412",
      repeatCount: 2,
      dedupKey: "api-5xx",
    },
  ),
  previewPage(
    "page_previewqueue",
    "Queue backlog over 10k jobs",
    "The email worker queue has 12,408 pending jobs and is growing.",
    22,
    {
      status: "acknowledged",
      notified: [ryan, maya],
      escalationStep: 1,
      nextEscalationAt: null,
      acknowledgedBy: ryan,
      acknowledgedAt: new Date(now - 15 * 60_000).toISOString(),
      source: "Worker health",
    },
  ),
];

export const previewOncallMe = {
  shifts: [
    { ...shift(ryan, handoffAt(-1), handoffAt(0)) },
    { ...shift(ryan, handoffAt(2), handoffAt(3)) },
  ].map((item) => ({
    ...item,
    groupId: "ocg_previewplatform",
    groupName: "Platform",
    teamId: PREVIEW_TEAM_ID,
    teamName: "Acme",
  })),
  pages: previewPages,
};
