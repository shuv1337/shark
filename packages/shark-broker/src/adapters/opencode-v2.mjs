import { isDeepStrictEqual } from "node:util";
import { BrokerError } from "../errors.mjs";
import { protectedJSON } from "../files.mjs";
import { digest } from "../json.mjs";
import { validateSession } from "../session.mjs";

export class OpenCodeAdapter {
  constructor({ fetchImpl = fetch, timeout = 10_000 } = {}) {
    this.fetch = fetchImpl;
    this.timeout = timeout;
  }
  async request(session, method, route, payload) {
    const ref = validateSession(session);
    const auth = await protectedJSON(ref.adapterData.authFile);
    if (
      typeof auth.password !== "string" ||
      auth.password.length < 1 ||
      auth.password.length > 4096
    )
      throw new BrokerError(3, "native_credentials_unavailable");
    const response = await this.fetch(ref.adapterData.serverUrl + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(this.timeout),
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${auth.password}`).toString("base64")}`,
        "content-type": "application/json",
        ...(ref.cwd ? { "x-opencode-directory": encodeURIComponent(ref.cwd) } : {}),
        ...(ref.adapterData.workspaceID
          ? { "x-opencode-workspace": ref.adapterData.workspaceID }
          : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const raw = await response.text();
    return { status: response.status, body: raw ? JSON.parse(raw) : undefined };
  }
  async probe(session) {
    try {
      const response = await this.request(
        session,
        "GET",
        `/api/session/${encodeURIComponent(session.sessionId)}`,
      );
      if (response.status === 404) return { status: "missing" };
      const info = response.body?.data;
      if (
        response.status !== 200 ||
        info?.id !== session.sessionId ||
        !Number.isSafeInteger(info.time?.created) ||
        typeof info.location?.directory !== "string"
      )
        return { status: "unknown", reason: "native_snapshot_unavailable" };
      if (session.generation !== undefined && info.time.created !== session.generation)
        return { status: "missing", reason: "session_generation_changed" };
      if (
        (session.cwd && session.cwd !== info.location.directory) ||
        (session.adapterData.workspaceID ?? null) !== (info.location.workspaceID ?? null)
      )
        return { status: "unknown", reason: "session_moved" };
      return {
        status: "available",
        session: validateSession({
          ...session,
          cwd: info.location.directory,
          generation: info.time.created,
        }),
      };
    } catch {
      return { status: "unknown", reason: "native_unavailable" };
    }
  }
  async deliver(session, input) {
    const probe = await this.probe(session);
    if (probe.status !== "available") return probe;
    try {
      const response = await this.request(
        session,
        "POST",
        `/api/session/${encodeURIComponent(session.sessionId)}/prompt`,
        input,
      );
      if (response.status === 404) return { status: "missing" };
      if (response.status === 409) return { status: "conflict" };
      const receipt = response.body?.data;
      if (
        response.status !== 200 ||
        receipt?.id !== input.id ||
        receipt.sessionID !== session.sessionId ||
        receipt.type !== "user" ||
        typeof receipt.payload?.text !== "string"
      )
        return { status: "unknown" };
      return receipt.payload.text === input.text && receipt.delivery === "queue"
        ? { status: "accepted" }
        : { status: "conflict" };
    } catch {
      return { status: "unknown" };
    }
  }
  async receipt(session, target) {
    try {
      const response = await this.request(
        session,
        "GET",
        `${this.requestRoute(session, target)}/receipt`,
      );
      return response.status === 200 ? response.body?.data : undefined;
    } catch {
      return undefined;
    }
  }
  requestRoute(session, target) {
    if (
      !["form", "permission"].includes(target.kind) ||
      typeof target.id !== "string" ||
      target.id.length > 512
    )
      throw new BrokerError(2, "invalid_native_request");
    return `/api/session/${encodeURIComponent(session.sessionId)}/${target.kind}/${encodeURIComponent(target.id)}`;
  }
  classifyReceipt(session, target, intent, receipt) {
    if (
      !receipt ||
      receipt.request?.id !== target.id ||
      receipt.request.sessionID !== session.sessionId
    )
      return { status: "unknown", reason: "receipt_unavailable" };
    if (digest(receipt.request) !== target.digest)
      return { status: "stale", reason: "request_changed" };
    if (receipt.state?.status === "cancelled")
      return { status: "stale", reason: "request_cancelled" };
    if (receipt.state?.status === "answered") {
      if (!intent) return { status: "superseded" };
      const expected = { status: "answered", ...intent.payload };
      return receipt.responseID === intent.responseID && isDeepStrictEqual(receipt.state, expected)
        ? { status: "accepted" }
        : { status: "superseded" };
    }
    return receipt.state?.status === "pending" && receipt.available === true
      ? { status: "pending" }
      : { status: "unknown", reason: "callback_unavailable" };
  }
  async activeState(session, target, intent) {
    const probe = await this.probe(session);
    if (probe.status !== "available") return probe;
    return this.classifyReceipt(session, target, intent, await this.receipt(session, target));
  }
  async answer(session, target, intent) {
    const before = await this.activeState(session, target, intent);
    if (before.status !== "pending") return before;
    try {
      await this.request(session, "POST", `${this.requestRoute(session, target)}/reply`, {
        ...intent.payload,
        responseID: intent.responseID,
      });
    } catch {
      /* Readback, never a replacement response ID. */
    }
    const after = await this.activeState(session, target, intent);
    return after.status === "pending"
      ? { status: "unknown", reason: "admission_unconfirmed" }
      : after;
  }
}
