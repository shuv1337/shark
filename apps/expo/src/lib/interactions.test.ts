import { Linking } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  categories: [] as Array<{
    actions: Array<Record<string, unknown>>;
    identifier: string;
  }>,
  badgeCounts: [] as number[],
  cookie: "session" as string | undefined,
  store: new Map<string, string>(),
  submissions: [] as Array<{ id: string; input: Record<string, unknown> }>,
  pageAcks: [] as Array<{ id: string; responseToken?: string }>,
  pageAckError: undefined as unknown,
  submit: undefined as
    | ((id: string, input: Record<string, unknown>) => Promise<unknown>)
    | undefined,
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => state.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    state.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    state.store.delete(key);
  },
}));

vi.mock("expo-notifications", () => ({
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  setNotificationCategoryAsync: async (
    identifier: string,
    actions: Array<Record<string, unknown>>,
  ) => {
    state.categories.push({ identifier, actions });
  },
  setBadgeCountAsync: async (value: number) => {
    state.badgeCounts.push(value);
    return true;
  },
}));

vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() } }));

vi.mock("./auth", () => ({ getCookie: () => state.cookie }));
vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number) {
      super("API error");
      this.status = status;
    }
  },
  api: {
    listInbox: async () => ({ items: [], nextCursor: null, unresolvedCount: 0 }),
    respondToInteraction: async (id: string, input: Record<string, unknown>) => {
      state.submissions.push({ id, input });
      return state.submit?.(id, input);
    },
    respondToInteractionWithToken: async (id: string, input: Record<string, unknown>) => {
      state.submissions.push({ id, input });
      return state.submit?.(id, input);
    },
    acknowledgePage: async (id: string) => {
      state.pageAcks.push({ id });
      if (state.pageAckError) throw state.pageAckError;
      return { page: {} };
    },
    acknowledgePageWithToken: async (id: string, responseToken: string) => {
      state.pageAcks.push({ id, responseToken });
      if (state.pageAckError) throw state.pageAckError;
      return { ok: true, status: "acknowledged" };
    },
  },
}));

import { router } from "expo-router";
import { ApiError } from "./api";
import {
  clearInteractionResponses,
  DEVICE_ID_KEY,
  flushInteractionResponses,
  flushPageAcknowledgements,
  handleNotificationResponse,
  registerInteractionCategories,
} from "./interactions";

function defaultResponse(url: string) {
  return {
    actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
    notification: {
      request: { content: { data: { url } } },
    },
  } as never;
}

const QUEUE_KEY = "hark.interaction.responseQueue.v1";
const DIGEST = "a".repeat(64);

function approvalResponse(interactionId: string) {
  return {
    actionIdentifier: "HARK_APPROVE",
    notification: {
      request: { content: { data: { interactionId, actionDigest: DIGEST } } },
    },
  } as never;
}

function credentialResponse(interactionId: string) {
  return {
    actionIdentifier: "HARK_APPROVE",
    notification: {
      request: {
        content: {
          data: { interactionId, actionDigest: DIGEST, responseToken: "r".repeat(43) },
        },
      },
    },
  } as never;
}

afterEach(async () => {
  vi.clearAllMocks();
  state.cookie = "session";
  state.categories.length = 0;
  state.badgeCounts.length = 0;
  state.submit = undefined;
  state.submissions.length = 0;
  state.pageAcks.length = 0;
  state.pageAckError = undefined;
  await clearInteractionResponses();
  state.store.clear();
  vi.mocked(Linking.openURL).mockReset();
});

describe("interaction notification categories", () => {
  it("keeps text replies inline and available from the lock screen", async () => {
    await registerInteractionCategories();
    const reply = state.categories.find(({ identifier }) => identifier === "HARK_REPLY_V1");
    expect(reply?.actions).toEqual([
      expect.objectContaining({
        identifier: "HARK_REPLY",
        textInput: { submitButtonTitle: "Send", placeholder: "Reply" },
        options: {
          isAuthenticationRequired: false,
          opensAppToForeground: false,
        },
      }),
    ]);
  });
});

describe("notification tap routing", () => {
  const sshuvPrefix = "https://app.example.test/conversation/v1/";
  const sshuvUrl = `${sshuvPrefix}synthetic_reference_1234567890`;
  const defaultResponse = (url: string) =>
    ({
      actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
      notification: {
        date: Date.now(),
        request: {
          content: {
            title: "Synthetic task",
            body: "Ready",
            data: { eventId: "evt_synthetic", url },
          },
        },
      },
    }) as never;

  it("forwards an explicitly configured SSHuv default tap before opening detail", async () => {
    vi.mocked(Linking.openURL).mockResolvedValue(undefined);
    const detail = vi.fn();
    await handleNotificationResponse(defaultResponse(sshuvUrl), detail, sshuvPrefix);
    expect(Linking.openURL).toHaveBeenCalledWith(sshuvUrl);
    expect(detail).not.toHaveBeenCalled();
    expect(state.submissions).toHaveLength(0);
  });

  it("keeps a durable detail fallback when forwarding fails", async () => {
    vi.mocked(Linking.openURL).mockRejectedValue(new Error("synthetic unavailable app"));
    const detail = vi.fn();
    await handleNotificationResponse(defaultResponse(sshuvUrl), detail, sshuvPrefix);
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(detail).toHaveBeenCalledWith(expect.objectContaining({ eventId: "evt_synthetic" }));
  });

  it.each([
    `${sshuvUrl}?command=approve`,
    sshuvUrl.replace("app.example.test", "other.example.test"),
    sshuvUrl.replace("/v1/", "/v2/"),
  ])("keeps invalid or untrusted SSHuv destinations inside SHark: %s", async (url) => {
    const detail = vi.fn();
    await handleNotificationResponse(defaultResponse(url), detail, sshuvPrefix);
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(detail).toHaveBeenCalledTimes(1);
  });

  it("never forwards an approval action even when its notification has an SSHuv URL", async () => {
    state.store.set(DEVICE_ID_KEY, "dev_synthetic");
    await handleNotificationResponse(
      {
        actionIdentifier: "HARK_APPROVE",
        notification: {
          request: {
            content: {
              data: {
                interactionId: "int_synthetic",
                actionDigest: DIGEST,
                url: sshuvUrl,
              },
            },
          },
        },
      } as never,
      vi.fn(),
      sshuvPrefix,
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(state.submissions[0]?.input.action).toBe("approve");
  });

  const urlOnlyResponse = (url: string) =>
    ({
      actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
      notification: { request: { content: { data: { url } } } },
    }) as never;

  it.each([sshuvPrefix, "invalid-prefix"])(
    "blocks untrusted URL-only taps when a prefix is configured: %s",
    async (prefix) => {
      vi.mocked(Linking.openURL).mockResolvedValue(undefined);
      const detail = vi.fn();
      await handleNotificationResponse(
        urlOnlyResponse("https://other.example.test/untrusted"),
        detail,
        prefix,
      );
      expect(Linking.openURL).not.toHaveBeenCalled();
      expect(detail).not.toHaveBeenCalled();
    },
  );

  it("blocks untrusted taps without a detail callback when a prefix is configured", async () => {
    vi.mocked(Linking.openURL).mockResolvedValue(undefined);
    await handleNotificationResponse(
      defaultResponse("https://other.example.test/untrusted"),
      undefined,
      sshuvPrefix,
    );
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("preserves legacy URL-only taps when SSHuv forwarding is disabled", async () => {
    vi.mocked(Linking.openURL).mockResolvedValue(undefined);
    const url = "https://example.test/legacy";
    await handleNotificationResponse(urlOnlyResponse(url), undefined, "");
    expect(Linking.openURL).toHaveBeenCalledWith(url);
  });

  it("forwards a valid URL-only SSHuv tap without requiring notification detail", async () => {
    vi.mocked(Linking.openURL).mockResolvedValue(undefined);
    await handleNotificationResponse(urlOnlyResponse(sshuvUrl), undefined, sshuvPrefix);
    expect(Linking.openURL).toHaveBeenCalledWith(sshuvUrl);
  });

  it("opens the durable in-app detail before an external rich link", async () => {
    const opened: Array<{ eventId: string | null }> = [];
    await handleNotificationResponse(
      {
        actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
        notification: {
          date: Date.now(),
          request: {
            content: {
              title: "Build finished",
              body: "Open the complete result.",
              data: { eventId: "evt_1", url: "https://example.com/result" },
            },
          },
        },
      } as never,
      (detail) => opened.push(detail),
    );
    expect(opened).toEqual([expect.objectContaining({ eventId: "evt_1" })]);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});

describe("interaction response queue", () => {
  it("submits with a response credential without a login cookie", async () => {
    state.cookie = undefined;
    state.store.set(DEVICE_ID_KEY, "dev_1");
    await handleNotificationResponse(credentialResponse("int_credential"));
    expect(state.submissions).toEqual([
      {
        id: "int_credential",
        input: {
          action: "approve",
          actionDigest: DIGEST,
          responseToken: "r".repeat(43),
          deviceId: "dev_1",
        },
      },
    ]);
  });
  it("preserves a response until registration provides a device ID", async () => {
    await handleNotificationResponse(approvalResponse("int_upgrade"));
    expect(state.submissions).toHaveLength(0);
    expect(JSON.parse(state.store.get(QUEUE_KEY) ?? "[]")).toEqual([
      {
        interactionId: "int_upgrade",
        input: { action: "approve", actionDigest: DIGEST },
      },
    ]);

    state.store.set(DEVICE_ID_KEY, "dev_registered");
    await flushInteractionResponses();
    expect(state.submissions).toEqual([
      {
        id: "int_upgrade",
        input: { action: "approve", actionDigest: DIGEST, deviceId: "dev_registered" },
      },
    ]);
    expect(state.store.has(QUEUE_KEY)).toBe(false);
  });

  it("automatically drains a response enqueued during a flush", async () => {
    state.store.set(DEVICE_ID_KEY, "dev_1");
    let releaseFirst: (() => void) | undefined;
    state.submit = (id) =>
      id === "int_first"
        ? new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve();

    const first = handleNotificationResponse(approvalResponse("int_first"));
    await vi.waitFor(() => expect(state.submissions).toHaveLength(1));
    const second = handleNotificationResponse(approvalResponse("int_second"));
    await vi.waitFor(() => expect(JSON.parse(state.store.get(QUEUE_KEY) ?? "[]")).toHaveLength(2));
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(state.submissions.map(({ id }) => id)).toEqual(["int_first", "int_second"]);
    expect(state.store.has(QUEUE_KEY)).toBe(false);
  });

  it("coalesces concurrent flushes", async () => {
    state.cookie = undefined;
    await handleNotificationResponse(approvalResponse("int_once"));
    state.cookie = "session";
    state.store.set(DEVICE_ID_KEY, "dev_1");

    await Promise.all([flushInteractionResponses(), flushInteractionResponses()]);
    expect(state.submissions.map(({ id }) => id)).toEqual(["int_once"]);
  });
});

describe("on-call pages", () => {
  const TOKEN = "p".repeat(43);
  const page = {
    v: 1,
    pageId: "page_1",
    teamId: "team_1",
    groupName: "Platform",
    categoryId: "HARK_PAGE_V1",
    responseToken: TOKEN,
    appId: "app_previewstatus",
    url: "https://status.example.com/incidents/1",
  };
  const pageResponse = (actionIdentifier: string, data: Record<string, unknown> = page) =>
    ({ actionIdentifier, notification: { request: { content: { data } } } }) as never;

  it("opens the page screen on tap, even when the page names an app", async () => {
    await handleNotificationResponse(pageResponse("expo.modules.notifications.actions.DEFAULT"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/pages/[id]",
      params: { id: "page_1" },
    });
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("asks before escalating from the notification action", async () => {
    await handleNotificationResponse(pageResponse("HARK_ESCALATE"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/pages/[id]",
      params: { id: "page_1", intent: "escalate" },
    });
    expect(state.pageAcks).toEqual([]);
  });

  it("acknowledges with the response token without a session", async () => {
    state.cookie = undefined;
    await handleNotificationResponse(pageResponse("HARK_ACKNOWLEDGE"));
    expect(state.pageAcks).toEqual([{ id: "page_1", responseToken: TOKEN }]);
    expect(state.store.get("hark.page.ackQueue.v1")).toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps an acknowledgement queued while offline and drops it once claimed", async () => {
    state.pageAckError = new Error("offline");
    await handleNotificationResponse(pageResponse("HARK_ACKNOWLEDGE"));
    expect(JSON.parse(state.store.get("hark.page.ackQueue.v1") ?? "[]")).toEqual([
      { pageId: "page_1", responseToken: TOKEN },
    ]);

    state.pageAckError = new (ApiError as unknown as new (status: number) => Error)(409);
    await flushPageAcknowledgements();
    expect(state.pageAcks).toHaveLength(2);
    expect(state.store.get("hark.page.ackQueue.v1")).toBeUndefined();
  });

  it("opens team invite links in the join screen", async () => {
    await handleNotificationResponse(defaultResponse("shark://join/abc123"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/join/[code]",
      params: { code: "abc123" },
    });
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
