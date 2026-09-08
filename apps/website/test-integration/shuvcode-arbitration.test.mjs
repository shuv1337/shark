import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { serve } from "@hono/node-server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  reconcileActiveReply,
  requestDigest,
  settleSharkInteraction,
} from "../../../docs/agent-reply-routing/arbitration-prototype/coordinator.mjs";
import { admitDeferredReply } from "../../../docs/agent-reply-routing/arbitration-prototype/deferred.mjs";
import {
  cancelInteraction,
  createInteraction,
  getInteraction,
} from "../../../packages/sharkctl/src/client.mjs";
import { shuvcodeFixture } from "./shuvcode-fixture.mjs";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
const binary = process.env.SHUV_ARBITRATION_BINARY;
if (!binary)
  throw new Error("Set SHUV_ARBITRATION_BINARY to the reviewed installed shuvcode binary");
const pushes = vi.hoisted(() => []);
vi.mock("../src/server/auth", () => ({
  auth: {
    handler: () => new Response("unused"),
    api: {
      getSession: async () => ({ user: { id: "arb_user", email: "arbitration@example.com" } }),
    },
  },
}));
vi.mock("../src/server/lib/billing", () => ({
  getBilling: async () => ({
    configured: true,
    plan: "pro",
    features: { deviceRouting: true },
    limits: {
      devices: null,
      notificationsPerMonth: 100_000,
      servicePerMinute: 10_000,
      accountPerMinute: 10_000,
    },
    usage: { notificationsRemaining: 1000 },
  }),
  checkNotificationAllowance: async () => true,
  trackNotification: async () => {},
  hasAutumn: () => false,
  clearBillingCache: () => {},
  createCheckout: async () => "https://example.com",
  createBillingPortal: async () => "https://example.com",
}));
vi.mock("expo-server-sdk", () => {
  class Expo {
    chunkPushNotifications(messages) {
      return [messages];
    }
    async sendPushNotificationsAsync(messages) {
      pushes.push(...messages);
      return messages.map(() => ({ status: "ok", id: "synthetic-ticket" }));
    }
  }
  return { Expo, default: Expo };
});
vi.mock("../src/server/lib/apns", () => ({
  isInvalidApnsTokenReason: () => false,
  sendLiveActivityPush: async () => {
    throw new Error("Unexpected APNs send");
  },
}));
vi.mock("../src/server/lib/web-push", () => ({
  sendWebPushNotifications: async (rows) => {
    expect(rows).toEqual([]);
    return { accepted: 0, errors: [], staleSubscriptionIds: [] };
  },
}));

let fixture;
let app;
let server;
let config;
let sessionID;
let serial = 0;
const secret = `hark_${"a".repeat(43)}`;
beforeAll(async () => {
  ({ app } = await import("../src/server/app"));
  const { db } = await import("../src/server/db");
  const schema = await import("../src/server/db/schema");
  const { hashApiToken } = await import("../src/server/lib/token");
  const { runMigrations } = await import("../src/server/db/migrate");
  runMigrations();
  const now = new Date();
  await db.insert(schema.user).values({
    id: "arb_user",
    name: "Synthetic",
    email: "arbitration@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.device).values({
    id: "arb_phone",
    userId: "arb_user",
    expoPushToken: "ExponentPushToken[synthetic]",
    platform: "ios",
    active: true,
    createdAt: now,
    lastSeenAt: now,
  });
  await db.insert(schema.apiToken).values({
    id: "arb_creator",
    userId: "arb_user",
    name: "Synthetic broker",
    tokenHash: hashApiToken(secret),
    prefix: secret.slice(0, 13),
    scopes: ["interactions:create", "interactions:read", "notifications:send", "devices:read"],
    createdAt: now,
  });
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  );
  config = { apiUrl: `http://127.0.0.1:${server.address().port}`, token: secret };
  fixture = await shuvcodeFixture(binary);
  expect((await fixture.native("GET", "/api/model/default")).status).toBe(200);
  const created = await fixture.native("POST", "/api/session", {
    location: { directory: fixture.root },
  });
  expect(created.status).toBe(200);
  sessionID = created.body.data.id;
  console.info(
    JSON.stringify({
      binaryVersion: execFileSync(binary, ["--version"], { encoding: "utf8" }).trim(),
      binarySha256: createHash("sha256")
        .update(await readFile(binary))
        .digest("hex"),
      freshNativeDatabase: true,
      sharkDatabase: "memory",
      pushes: "mocked",
      externalNativeNetwork: "denied",
    }),
  );
});
afterAll(async () => {
  await fixture?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

it("a delayed SHark reply queues behind desktop work and executes once across response loss and restart", async () => {
  const created = await fixture.native("POST", "/api/session", {
    title: "Synthetic deferred conversation",
    model: { providerID: "arbitration-fixture", id: "synthetic" },
    location: { directory: fixture.root },
  });
  expect(created.status).toBe(200);
  const id = created.body.data.id;
  const route = `/api/session/${id}`;
  const initialCalls = fixture.modelCalls();
  fixture.holdNextModel();
  expect(
    (
      await fixture.native("POST", `${route}/prompt`, {
        id: "msg_desktop_before_reply",
        text: "Synthetic desktop work",
        delivery: "queue",
      })
    ).status,
  ).toBe(200);
  await vi.waitFor(() => expect(fixture.modelCalls()).toBe(initialCalls + 1), { timeout: 10_000 });
  const createdShark = await createInteraction(
    config,
    {
      title: "Synthetic completion",
      prompt: "Previous work complete.\n\nWhat next?",
      kind: "reply",
      deviceIds: ["arb_phone"],
    },
    { idempotencyKey: "synthetic-deferred" },
  );
  expect(createdShark.accepted).toBe(1);
  const interaction = createdShark.interaction;
  const response = await app.request(`/api/interactions/${interaction.id}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "reply",
      response: "Review the result; $(this-is-data)",
      deviceId: "arb_phone",
      actionDigest: interaction.actionDigest,
    }),
  });
  expect(response.status).toBe(200);
  const stored = (await getInteraction(config, interaction.id)).interaction;
  expect(stored.status).toBe("replied");
  const input = {
    id: "msg_shark_deferred_reply",
    text: `Question: What next?\n\nReply: ${stored.response}`,
  };
  const lossy = async (...args) => {
    const result = await fixture.native(...args);
    if (args[0] === "POST") {
      expect(result.status).toBe(200);
      throw new Error("Synthetic dropped admission response");
    }
    return result;
  };
  expect(await admitDeferredReply({ native: lossy, sessionID: id, input })).toEqual({
    status: "unknown",
  });
  expect(await admitDeferredReply({ native: fixture.native, sessionID: id, input })).toEqual({
    status: "accepted",
  });
  const inbox = (await fixture.native("GET", `${route}/inbox`)).body.data;
  expect(inbox.map((entry) => entry.id)).toEqual([input.id]);
  expect(fixture.modelCalls()).toBe(initialCalls + 1);
  fixture.releaseModel();
  expect((await fixture.native("POST", `${route}/wait`)).status).toBe(204);
  expect(fixture.modelCalls()).toBe(initialCalls + 2);
  const before = (await fixture.native("GET", `${route}/context`)).body.data;
  expect(before.filter((message) => message.type === "user").map((message) => message.id)).toEqual([
    "msg_desktop_before_reply",
    input.id,
  ]);
  expect(before.find((message) => message.id === input.id).text).toBe(input.text);
  expect(
    before.filter((message) => message.type === "assistant").map((message) => message.finish),
  ).toEqual(["stop", "stop"]);
  await fixture.restart();
  expect(await admitDeferredReply({ native: fixture.native, sessionID: id, input })).toEqual({
    status: "accepted",
  });
  expect((await fixture.native("POST", `${route}/wait`)).status).toBe(204);
  await delay(100);
  expect(fixture.modelCalls()).toBe(initialCalls + 2);
  expect((await fixture.native("GET", `${route}/context`)).body.data).toEqual(before);
  expect(
    await admitDeferredReply({
      native: fixture.native,
      sessionID: id,
      input: { ...input, text: "Changed retry must conflict locally" },
    }),
  ).toEqual({ status: "conflict" });
});

async function setup(kind = "form") {
  const id = `${kind === "form" ? "frm" : "per"}_arbitration_${++serial}`;
  const route = `/api/session/${sessionID}/${kind}/${id}`;
  const created = await fixture.native(
    "POST",
    `/api/session/${sessionID}/${kind}`,
    kind === "form"
      ? { id, title: "Synthetic question", fields: [{ key: "answer", type: "string" }] }
      : { id, action: "shell", resources: ["pwd"] },
  );
  expect(created.status).toBe(200);
  if (kind === "permission") expect(created.body.data.effect).toBe("ask");
  const receipt = await fixture.native("GET", `${route}/receipt`);
  expect(receipt.status).toBe(200);
  const target = {
    kind,
    sessionID,
    requestID: id,
    digest: requestDigest(receipt.body.data.request),
  };
  const shark = await createInteraction(
    config,
    {
      title: "Synthetic",
      prompt: "Bound native request",
      kind: kind === "form" ? "reply" : "approval",
      deviceIds: ["arb_phone"],
    },
    { idempotencyKey: `arbitration-${serial}` },
  );
  expect(shark.accepted).toBe(1);
  const interaction = shark.interaction;
  const intent = {
    responseID: `reply-arbitration-${serial}`,
    payload:
      kind === "form"
        ? { answer: { answer: "$(never-execute); `also-inert`" } }
        : { reply: "once" },
  };
  const settle = (outcome) =>
    settleSharkInteraction({
      outcome,
      get: () => getInteraction(config, interaction.id),
      cancel: () => cancelInteraction(config, interaction.id),
    });
  const phone = async () => {
    const response = await app.request(`/api/interactions/${interaction.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(kind === "form"
          ? { action: "reply", response: intent.payload.answer.answer }
          : { action: "approve" }),
        deviceId: "arb_phone",
        actionDigest: interaction.actionDigest,
      }),
    });
    expect(response.status).toBe(200);
    const stored = (await getInteraction(config, interaction.id)).interaction;
    if (kind === "form") {
      expect(stored.status).toBe("replied");
      intent.payload = { answer: { answer: stored.response } };
    } else {
      expect(stored.status).toBe("approved");
      intent.payload = { reply: "once" };
    }
  };
  return { route, target, interaction, intent, settle, phone };
}

it("a phone reply is admitted once and exact replay does not POST again", async () => {
  const row = await setup();
  await row.phone();
  let posts = 0;
  const native = async (...args) => {
    if (args[0] === "POST") posts++;
    return fixture.native(...args);
  };
  expect(await row.settle(await reconcileActiveReply({ native, ...row }))).toMatchObject({
    status: "accepted",
    sharkStatus: "replied",
    conflictingReply: false,
  });
  expect((await reconcileActiveReply({ native, ...row })).status).toBe("accepted");
  expect(posts).toBe(1);
});

it("desktop-first cancels the outstanding SHark prompt", async () => {
  const row = await setup();
  expect(
    (await fixture.native("POST", `${row.route}/reply`, { answer: { answer: "Desktop" } })).status,
  ).toBe(204);
  expect(
    await row.settle(await reconcileActiveReply({ native: fixture.native, ...row })),
  ).toMatchObject({ status: "superseded", sharkStatus: "canceled", cleanupPending: false });
});

it("a stored SHark answer losing the native race remains visibly superseded", async () => {
  const row = await setup();
  await row.phone();
  let posts = 0;
  const native = async (...args) => {
    if (args[0] === "POST") {
      posts++;
      expect(
        (
          await fixture.native("POST", `${row.route}/reply`, {
            answer: { answer: "Desktop wins CAS" },
            responseID: "desktop-race",
          })
        ).status,
      ).toBe(204);
    }
    return fixture.native(...args);
  };
  expect(await row.settle(await reconcileActiveReply({ native, ...row }))).toMatchObject({
    status: "superseded",
    sharkStatus: "replied",
    conflictingReply: true,
  });
  expect(posts).toBe(1);
});

it("lost HTTP response reconciles the committed native receipt", async () => {
  const row = await setup();
  await row.phone();
  const native = async (...args) => {
    const result = await fixture.native(...args);
    if (args[0] === "POST") {
      expect(result.status).toBe(204);
      throw new Error("Synthetic acknowledgement loss");
    }
    return result;
  };
  expect((await reconcileActiveReply({ native, ...row })).status).toBe("accepted");
});

it("permission decisions preserve once scope and reject a competing denial", async () => {
  const row = await setup("permission");
  await row.phone();
  expect((await reconcileActiveReply({ native: fixture.native, ...row })).status).toBe("accepted");
  expect((await fixture.native("GET", `${row.route}/receipt`)).body.data.state).toEqual({
    status: "answered",
    reply: "once",
  });
  expect((await fixture.native("POST", `${row.route}/reply`, { reply: "reject" })).status).toBe(
    404,
  );
});

it("desktop denial supersedes an approval already stored in SHark", async () => {
  const row = await setup("permission");
  await row.phone();
  expect(
    (
      await fixture.native("POST", `${row.route}/reply`, {
        reply: "reject",
        responseID: "desktop-denial",
      })
    ).status,
  ).toBe(204);
  expect(
    await row.settle(await reconcileActiveReply({ native: fixture.native, ...row })),
  ).toMatchObject({ status: "superseded", sharkStatus: "approved", conflictingReply: true });
});

it("a SHark response racing cancellation remains recoverable", async () => {
  const row = await setup();
  expect(
    (await fixture.native("POST", `${row.route}/reply`, { answer: { answer: "Desktop" } })).status,
  ).toBe(204);
  const outcome = await reconcileActiveReply({ native: fixture.native, ...row });
  const result = await settleSharkInteraction({
    outcome,
    get: () => getInteraction(config, row.interaction.id),
    cancel: async () => {
      await row.phone();
      return cancelInteraction(config, row.interaction.id);
    },
  });
  expect(result).toMatchObject({
    status: "superseded",
    sharkStatus: "replied",
    conflictingReply: true,
    cleanupPending: false,
  });
});

it("missing native receipts cannot cancel a valid SHark request or submit input", async () => {
  const row = await setup();
  const native = async (method) => {
    expect(method).toBe("GET");
    return { status: 404 };
  };
  expect(await row.settle(await reconcileActiveReply({ native, ...row }))).toMatchObject({
    status: "unknown",
    sharkStatus: "pending",
    cleanupPending: false,
  });
});

it("simultaneous exact retries converge on the same native answer", async () => {
  const row = await setup();
  await row.phone();
  const results = await Promise.all([
    reconcileActiveReply({ native: fixture.native, ...row }),
    reconcileActiveReply({ native: fixture.native, ...row }),
  ]);
  expect(results).toEqual([{ status: "accepted" }, { status: "accepted" }]);
  const stored = (await fixture.native("GET", `${row.route}/receipt`)).body.data;
  expect(stored.responseID).toBe(row.intent.responseID);
  expect(stored.state.answer).toEqual(row.intent.payload.answer);
});

it("restart preserves accepted receipts and fences unavailable pending callbacks", async () => {
  const answered = await setup();
  await answered.phone();
  const pending = await setup();
  expect(
    (
      await fixture.native("POST", `${answered.route}/reply`, {
        ...answered.intent.payload,
        responseID: answered.intent.responseID,
      })
    ).status,
  ).toBe(204);
  await fixture.restart();
  const native = async (...args) => {
    expect(args[0]).toBe("GET");
    return fixture.native(...args);
  };
  expect((await reconcileActiveReply({ native, ...answered })).status).toBe("accepted");
  expect(await pending.settle(await reconcileActiveReply({ native, ...pending }))).toMatchObject({
    status: "unknown",
    reason: "callback_unavailable",
    sharkStatus: "pending",
  });
});

async function brokerStore(name) {
  const { Store } = await import("../../../packages/shark-broker/src/store.mjs");
  const path = await import("node:path");
  return Store.open(path.join(fixture.root, `${name}.sqlite`));
}
async function brokerPhone(id, action = "reply") {
  const { interaction } = await getInteraction(config, id);
  const response = await app.request(`/api/interactions/${id}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      ...(action === "reply" ? { response: "Synthetic $(inert) reply" } : {}),
      deviceId: "arb_phone",
      actionDigest: interaction.actionDigest,
    }),
  });
  expect(response.status).toBe(200);
}
async function brokerWorker(message) {
  const { fork } = await import("node:child_process");
  const child = fork(
    new URL("../../../packages/shark-broker/test/crash-worker.mjs", import.meta.url),
    [],
    {
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Broker worker timed out")), 15_000);
      child.once("message", (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Broker exited without result"));
      });
      child.send(message);
    });
    if (message.crashAt) {
      expect(result).toEqual({ stage: message.crashAt });
      child.kill("SIGKILL");
    } else expect(result.error).toBeUndefined();
    await exited;
    return result;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}

for (const stage of [
  "prepared",
  "create_response",
  "create_attached",
  "reply_prepared",
  "before_admission",
  "after_admission",
]) {
  it(`broker survives SIGKILL at ${stage} with one interaction and native input`, async () => {
    const { default: path } = await import("node:path");
    const created = await fixture.native("POST", "/api/session", {
      title: `Broker crash ${stage}`,
      model: { providerID: "arbitration-fixture", id: "synthetic" },
      location: { directory: fixture.root },
    });
    expect(created.status).toBe(200);
    const nativeID = created.body.data.id;
    const input = {
      summary: "Completed synthetic work",
      question: "Continue?",
      idempotencyKey: `broker-crash-${stage}`,
      session: await fixture.sessionReference(nativeID),
    };
    const database = path.join(fixture.root, `crash-${stage}.sqlite`);
    const creationStage = ["prepared", "create_response", "create_attached"].includes(stage);
    const beforePushes = pushes.length;
    await brokerWorker({ database, config, input, ...(creationStage ? { crashAt: stage } : {}) });
    const store = await brokerStore(`crash-${stage}`);
    try {
      const id = store.byKey(input.idempotencyKey).id;
      if (creationStage) await brokerWorker({ database, config, id, clockOffset: 61_000 });
      let row = store.get(id);
      expect(row.state).toBe("pending");
      expect(pushes.length - beforePushes).toBe(1);
      await brokerPhone(row.data.serverID);
      if (!creationStage)
        await brokerWorker({ database, config, id, crashAt: stage, clockOffset: 61_000 });
      await brokerWorker({ database, config, id, clockOffset: 122_000 });
      row = store.get(id);
      expect(row.state).toBe("delivered");
      const deliveryID = row.data.deliveryID;
      await brokerWorker({ database, config, id, clockOffset: 183_000 });
      expect((await fixture.native("POST", `/api/session/${nativeID}/wait`)).status).toBe(204);
      const events = await fixture.native("GET", `/api/session/${nativeID}/context`);
      expect(events.status).toBe(200);
      expect(events.body.data.filter((event) => event.id === deliveryID)).toHaveLength(1);
      expect(store.get(id).data.deliveryID).toBe(deliveryID);
      expect(pushes.length - beforePushes).toBe(1);
    } finally {
      store.close();
    }
  });
}

for (const kind of ["form", "permission"]) {
  for (const desktopFirst of [false, true])
    it(`broker ${kind} arbitration preserves ${desktopFirst ? "desktop" : "phone"} winner`, async () => {
      const { Broker } = await import("../../../packages/shark-broker/src/broker.mjs");
      const id = `${kind === "form" ? "frm" : "per"}_broker_${++serial}`;
      const route = `/api/session/${sessionID}/${kind}/${id}`;
      expect(
        (
          await fixture.native(
            "POST",
            `/api/session/${sessionID}/${kind}`,
            kind === "form"
              ? { id, title: "Broker question", fields: [{ key: "answer", type: "string" }] }
              : { id, action: "shell", resources: ["pwd"] },
          )
        ).status,
      ).toBe(200);
      const store = await brokerStore(`active-${serial}`);
      try {
        const broker = new Broker({ store, config });
        const registration = await broker.registerActive({
          session: await fixture.sessionReference(sessionID),
          kind,
          requestID: id,
          prompt: "Synthetic active question",
          idempotencyKey: `broker-active-${serial}`,
        });
        expect(registration.state).toBe("pending");
        await brokerPhone(registration.interactionId, kind === "form" ? "reply" : "approve");
        if (desktopFirst)
          expect(
            (
              await fixture.native(
                "POST",
                `${route}/reply`,
                kind === "form" ? { answer: { answer: "Desktop wins" } } : { reply: "reject" },
              )
            ).status,
          ).toBe(204);
        const result = await broker.process(registration.id, undefined, true);
        expect(result.state).toBe(desktopFirst ? "superseded" : "delivered");
        const row = store.get(result.id);
        expect(row.data.reply.status).toBe(kind === "form" ? "replied" : "approved");
        expect(row.data.conflictingReply ?? false).toBe(desktopFirst);
        const receipt = (await fixture.native("GET", `${route}/receipt`)).body.data;
        expect(receipt.state.status).toBe("answered");
        if (!desktopFirst) expect(receipt.responseID).toBe(row.data.deliveryID);
        if (kind === "permission")
          expect(receipt.state.reply).toBe(desktopFirst ? "reject" : "once");
      } finally {
        store.close();
      }
    });
}

it("broker concurrent registration and SIGKILL after cancellation preserve one durable outcome", async () => {
  const path = await import("node:path");
  const input = {
    summary: "Concurrent synthetic work",
    question: "Continue?",
    idempotencyKey: "broker-concurrent",
    session: await fixture.sessionReference(sessionID),
  };
  const database = path.join(fixture.root, "concurrent.sqlite");
  const beforePushes = pushes.length;
  await Promise.all([
    brokerWorker({ database, config, input }),
    brokerWorker({ database, config, input }),
  ]);
  const store = await brokerStore("concurrent");
  try {
    const id = store.byKey(input.idempotencyKey).id;
    await brokerWorker({ database, config, id, clockOffset: 61_000 });
    expect(store.list()).toHaveLength(1);
    expect(store.get(id).state).toBe("pending");
    expect(pushes.length - beforePushes).toBe(1);
    await brokerWorker({
      database,
      config,
      id,
      action: "discard",
      crashAt: "cancel_response",
      clockOffset: 61_000,
    });
    expect(store.get(id).state).toBe("canceling");
    await brokerWorker({ database, config, id, clockOffset: 122_000 });
    expect(store.get(id).state).toBe("discarded");
    expect((await getInteraction(config, store.get(id).data.serverID)).interaction.status).toBe(
      "canceled",
    );
    expect(pushes.length - beforePushes).toBe(1);
  } finally {
    store.close();
  }
});
