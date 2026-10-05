import type {
  AppDto,
  InboxActivityDto,
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxNotificationDetailDto,
  InboxNotificationSummaryDto,
  InboxProjectsDto,
} from "@hark/contracts";

export const PREVIEW_AVATAR_URL =
  "https://pbs.twimg.com/profile_images/2070959207273082880/HZoVBuA2_400x400.jpg";

const now = Date.now();

export const previewPending: InboxInteractionDto[] = [
  {
    id: "preview-deploy",
    sourceName: "Release agent",
    sourceImageUrl: PREVIEW_AVATAR_URL,
    projectId: "preview-project-app",
    title: "Production deploy",
    prompt: "Deploy version 2.4.1 to production?",
    kind: "approval",
    presentation: "notification",
    status: "pending",
    choices: ["approve", "deny"],
    response: null,
    imageUrl: null,
    url: null,
    actionDigest: "a".repeat(64),
    primaryLabel: null,
    secondaryLabel: null,
    accepted: 1,
    respondingDeviceId: null,
    expiresAt: new Date(now + 13 * 60_000).toISOString(),
    createdAt: new Date(now - 2 * 60_000).toISOString(),
    respondedAt: null,
    canceledAt: null,
  },
  {
    id: "preview-support",
    sourceName: "Support bot",
    sourceImageUrl: PREVIEW_AVATAR_URL,
    projectId: null,
    title: "Customer reply",
    prompt: "How should I respond to the customer's request for an extension?",
    kind: "reply",
    presentation: "notification",
    status: "pending",
    choices: ["reply"],
    response: null,
    imageUrl: null,
    url: null,
    actionDigest: "b".repeat(64),
    primaryLabel: null,
    secondaryLabel: null,
    accepted: 1,
    respondingDeviceId: null,
    expiresAt: new Date(now + 42 * 60_000).toISOString(),
    createdAt: new Date(now - 18 * 60_000).toISOString(),
    respondedAt: null,
    canceledAt: null,
  },
];

export const previewActive: InboxLiveActivityDto[] = [
  {
    id: "preview-activity",
    sourceName: "Deploy agent",
    sourceImageUrl: PREVIEW_AVATAR_URL,
    projectId: "preview-project-app",
    key: "production-deploy",
    props: {
      schemaVersion: 1,
      activityId: "preview-activity",
      title: "Production deployment",
      status: "Running",
      detail: "Running integration tests",
      progress: 0.72,
      updatedAt: new Date(now).toISOString(),
      symbol: "build",
      privacyMode: "standard",
    },
    status: "active",
    sequence: 4,
    accepted: 1,
    failed: 0,
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    createdAt: new Date(now - 20 * 60_000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    endedAt: null,
  },
];

const activityTemplates: Array<Pick<InboxActivityDto, "kind" | "sourceName" | "title" | "result">> =
  [
    {
      kind: "response",
      sourceName: "GitHub",
      title: "Merge dependency update",
      result: "Approved",
    },
    {
      kind: "notification",
      sourceName: "Build agent",
      title: "Integration tests passed",
      result: null,
    },
    {
      kind: "live_activity",
      sourceName: "Deploy agent",
      title: "Production deployment",
      result: "Completed",
    },
    {
      kind: "response",
      sourceName: "Support bot",
      title: "Customer response sent",
      result: "Replied",
    },
  ];

export const previewActivity: InboxActivityDto[] = Array.from({ length: 24 }, (_, index) => {
  const template = activityTemplates[index % activityTemplates.length];
  if (!template) throw new Error("Missing preview activity template");
  return {
    ...template,
    id: `preview-feed-${index}`,
    sourceImageUrl: PREVIEW_AVATAR_URL,
    detail: null,
    url: null,
    createdAt: new Date(now - (index + 1) * 15 * 60_000).toISOString(),
  };
});

export const previewProjects: InboxProjectsDto = {
  projects: [
    {
      projectId: "preview-project-app",
      name: "Acme App",
      unreadCount: 3,
      totalCount: 18,
      latestTitle: "Deploy bot",
      latestPreview: "Deploy finished: 3 services updated, 0 rollbacks",
      latestImageUrl: PREVIEW_AVATAR_URL,
      latestAt: new Date(now - 4 * 60_000).toISOString(),
    },
    {
      projectId: "preview-project-site",
      name: "Marketing site",
      unreadCount: 0,
      totalCount: 7,
      latestTitle: "Build agent",
      latestPreview: "Lighthouse run complete — all budgets passing",
      latestImageUrl: PREVIEW_AVATAR_URL,
      latestAt: new Date(now - 3 * 3_600_000).toISOString(),
    },
    {
      projectId: null,
      name: "Other",
      unreadCount: 1,
      totalCount: 42,
      latestTitle: "Monitor",
      latestPreview: "Disk usage back under 80% on web-1",
      latestImageUrl: PREVIEW_AVATAR_URL,
      latestAt: new Date(now - 26 * 3_600_000).toISOString(),
    },
  ],
  totalUnread: 4,
};

/** Local page served during simulator development to exercise the web view bridge. */
export const PREVIEW_APP_ORIGIN = "http://localhost:8790";

function previewApp(
  id: string,
  name: string,
  url: string,
  minutesAgo: number | null,
  consented = true,
): AppDto {
  const createdAt = new Date(now - 3 * 86_400_000).toISOString();
  return {
    id,
    name,
    origin: new URL(url).origin,
    iconUrl: null,
    url,
    projectId: "preview-project-app",
    projectName: "Acme App",
    shareName: true,
    shareEmail: false,
    consentedAt: consented ? createdAt : null,
    lastOpenedAt: minutesAgo === null ? null : new Date(now - minutesAgo * 60_000).toISOString(),
    createdBy: "harkctl on Ryan’s MacBook Pro",
    createdAt,
    updatedAt: createdAt,
  };
}

export const previewApps: AppDto[] = [
  previewApp("app_previewreleases", "Releases", `${PREVIEW_APP_ORIGIN}/`, 2, false),
  previewApp("app_previewevals", "Evals", "https://example.com/", 60 * 20),
  previewApp("app_previewpantry", "Pantry", "https://example.org/", 60 * 24 * 7),
  previewApp("app_previewopslog", "Ops Log", "https://example.net/", 60 * 24 * 23),
  previewApp("app_previewinvoices", "Invoices", "https://example.edu/", null),
];

export const previewNotifications: InboxNotificationSummaryDto[] = Array.from(
  { length: 14 },
  (_, index) => ({
    id: `event:preview-notification-${index}`,
    origin: "event" as const,
    projectId: "preview-project-app",
    projectName: "Acme App",
    sourceName: index === 0 ? "Release agent" : index % 3 === 0 ? "Deploy bot" : "Build agent",
    sourceImageUrl: PREVIEW_AVATAR_URL,
    title:
      index === 0
        ? "Preview build #185 is ready"
        : index % 3 === 0
          ? "Deploy finished"
          : `Build ${48 - index} passed`,
    preview:
      index === 0
        ? "The new onboarding flow is ready for review."
        : index % 3 === 0
          ? "Deploy finished: 3 services updated, 0 rollbacks"
          : "Integration tests passed on iOS and web targets",
    url: null,
    bodyFormat: "text" as const,
    readAt: index < 3 ? null : new Date(now - index * 50 * 60_000).toISOString(),
    createdAt: new Date(now - (index + 1) * 45 * 60_000).toISOString(),
    app:
      index === 0
        ? { id: "app_previewreleases", name: "Releases", origin: PREVIEW_APP_ORIGIN, iconUrl: null }
        : null,
  }),
);

export function previewNotificationDetail(id: string): InboxNotificationDetailDto {
  const summary = previewNotifications.find((item) => item.id === id) ?? previewNotifications[0];
  if (!summary) throw new Error("Missing preview notification");
  return {
    ...summary,
    id,
    preview: summary.preview,
    body: summary.app
      ? [
          "The new onboarding flow is ready for review.",
          "",
          "Changes: Apple sign-in moved first, shorter welcome copy, and a skip button on step 2. Leave feedback on the board and I'll pick it up.",
        ].join("\n")
      : [
          "Deploy finished: 3 services updated, 0 rollbacks.",
          "",
          "Services: api (2m 14s), worker (1m 52s), web (3m 08s).",
          "Release notes: https://example.com/releases/2-4-1",
          "Dashboard: https://example.com/deploys/184",
        ].join("\n"),
    summary: "Deploy finished: 3 services updated, 0 rollbacks",
    status: "accepted",
  };
}
