import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Broker } from "../src/broker.mjs";
import { digest, stableJSON } from "../src/json.mjs";
import { REQUIRED_SCOPES } from "../src/shark.mjs";
import { Store } from "../src/store.mjs";

export const session = {
  version: 1,
  harness: "opencode-v2",
  sessionId: "ses_synthetic",
  cwd: "/synthetic/project",
  adapterData: { serverUrl: "http://127.0.0.1:12345", authFile: "/synthetic/auth.json" },
};
export const completion = (key = "synthetic-turn") => ({
  summary: "Finished synthetic work.",
  question: "What next?",
  session,
  idempotencyKey: key,
});
export const requestError = (status, error) =>
  Object.assign(new Error("synthetic request error"), { status, body: { error } });

export async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "sharkd-broker-"));
  let time = Date.now();
  const now = () => time;
  const file = path.join(root, "broker.sqlite");
  const stores = [];
  const open = async () => {
    const store = await Store.open(file, { now });
    stores.push(store);
    return store;
  };
  const store = await open();
  t.after(async () => {
    for (const db of stores) db.close();
    await rm(root, { recursive: true, force: true });
  });
  const state = {
    tokenID: "synthetic-creator",
    scopes: [...REQUIRED_SCOPES],
    accepted: 1,
    probe: "available",
    createCalls: 0,
    cancelCalls: 0,
    deliverCalls: 0,
    unknownDelivery: false,
  };
  const remote = new Map();
  const native = new Map();
  const api = {
    auth: async () => ({ authenticated: true, token: { id: state.tokenID, scopes: state.scopes } }),
    devices: async () => ({
      devices: [
        { id: "phone", platform: "ios", active: true, lastSeenAt: new Date(now()).toISOString() },
        { id: "web", platform: "web", active: true, lastSeenAt: new Date(now() + 1).toISOString() },
      ],
    }),
    create: async (kind, payload, key) => {
      state.createCalls++;
      if (state.createError) throw state.createError;
      const prior = [...remote.values()].find((entry) => entry.key === key);
      if (prior && prior.hash !== digest(payload)) throw requestError(409, "mismatch");
      const item = prior ?? {
        id: `synthetic_${remote.size + 1}`,
        key,
        hash: digest(payload),
        kind: payload.kind,
        status: "pending",
        accepted: state.accepted,
        expiresAt: new Date(now() + (payload.expiresInSeconds ?? 3600) * 1000).toISOString(),
      };
      if (!prior) remote.set(item.id, item);
      return {
        ...(kind === "notification"
          ? { notification: { id: item.id } }
          : { interaction: { ...item } }),
        accepted: item.accepted,
        ...(prior ? { idempotent: true } : {}),
      };
    },
    get: async (id) => {
      if (state.getError) throw state.getError;
      const item = remote.get(id);
      if (!item) throw requestError(404, "missing");
      if (item.status === "pending" && Date.parse(item.expiresAt) <= now()) item.status = "expired";
      return { interaction: { ...item } };
    },
    cancel: async (id) => {
      state.cancelCalls++;
      if (state.cancelError) throw state.cancelError;
      const item = (await api.get(id)).interaction;
      if (item.status !== "pending")
        throw Object.assign(requestError(409, "terminal"), { body: { interaction: item } });
      remote.get(id).status = "canceled";
      return api.get(id);
    },
  };
  const adapter = {
    probe: async (ref) => ({
      status: state.probe,
      ...(state.probe === "available" ? { session: { ...ref, generation: 1 } } : {}),
    }),
    deliver: async (_ref, input) => {
      state.deliverCalls++;
      if (state.probe !== "available") return { status: state.probe };
      if (state.unknownDelivery) return { status: "unknown" };
      const existing = native.get(input.id);
      if (existing && existing !== stableJSON(input)) return { status: "conflict" };
      native.set(input.id, stableJSON(input));
      return { status: "accepted" };
    },
  };
  const config = { apiUrl: "https://example.invalid", token: `hark_${"a".repeat(43)}` };
  const broker = (extra = {}) =>
    new Broker({ store, config, api, adapter, now, random: () => 0.5, ...extra });
  const answer = (id, response = "Synthetic answer") => {
    const item = remote.get(store.get(id).data.serverID);
    item.status = "replied";
    item.response = response;
  };
  return {
    root,
    file,
    store,
    open,
    state,
    remote,
    native,
    api,
    adapter,
    config,
    broker,
    answer,
    now,
    advance: (ms) => {
      time += ms;
    },
  };
}
