import { describe, expect, it } from "vitest";
import {
  boardAckCall,
  boardAnswersCall,
  boardAskCall,
  boardCancelCall,
  boardDoneCall,
  boardGetCall,
  boardNoteCall,
  boardNoteClearCall,
  boardToolSchemas,
  boardWaitCall,
  boardWorkCall,
  boardWorkGetCall,
} from "../../../integrations/executor/board";
import {
  notificationPayload,
  resolveSharkOrigin,
  SHARK_ORIGIN,
  sharkRequest,
} from "../../../integrations/executor/shark";

const token = "synthetic-token";

describe("Executor board calls", () => {
  it("builds ask, cancel, get, wait, answers, and ack requests", () => {
    const ask = boardAskCall(
      {
        key: "fm:ship",
        title: "Ship?",
        kind: "approval",
        options: [{ id: "yes", label: "Yes", style: "primary" }],
        agentDisplay: " Grok Bot ",
        callbackUrl: "https://example.com/hook",
      },
      "callback-token-value",
    );
    expect(ask).toMatchObject({
      method: "PUT",
      path: "/api/agent/board/asks",
      body: {
        key: "fm:ship",
        title: "Ship?",
        kind: "approval",
        agentDisplay: "Grok Bot",
        callback: { url: "https://example.com/hook", token: "callback-token-value" },
      },
    });
    expect(JSON.stringify(ask.body)).not.toContain("undefined");
    expect(() =>
      boardAskCall({ key: "k", title: "T", callbackUrl: "https://example.com/hook" }, undefined),
    ).toThrow(/board callback token/);

    expect(boardCancelCall("fm:ship", "Moot")).toEqual({
      method: "POST",
      path: "/api/agent/board/asks/fm%3Aship/cancel",
      body: { reason: "Moot" },
    });
    expect(boardGetCall("a/b")).toEqual({
      method: "GET",
      path: "/api/agent/board/asks/a%2Fb",
    });
    expect(boardWaitCall("fm:ship", 100).path).toBe(
      "/api/agent/board/asks/fm%3Aship/wait?timeout=25",
    );
    expect(boardWaitCall("fm:ship", undefined).path).toContain("timeout=20");
    expect(boardWaitCall("fm:ship", 0).path).toContain("timeout=0");
    expect(boardAnswersCall("cursor", 500).path).toBe(
      "/api/agent/board/answers?since=cursor&limit=100",
    );
    expect(boardAckCall("fm:ship").method).toBe("POST");
  });

  it("builds work, done, note, and note-clear requests, keeping null clears", () => {
    expect(
      boardWorkCall({
        key: "spike",
        title: "Retire sharkctl",
        state: "review",
        agentDisplay: null,
        heartbeatTtlSeconds: null,
        detail: "findings ready",
      }).body,
    ).toEqual({
      key: "spike",
      title: "Retire sharkctl",
      state: "review",
      agentDisplay: null,
      heartbeatTtlSeconds: null,
      detail: "findings ready",
    });
    expect(boardWorkGetCall("spike-retire").path).toBe("/api/agent/board/work/spike-retire");
    expect(
      boardDoneCall("spike", { verb: "reported", outcome: "done", agentDisplay: "Grok Bot" }).body,
    ).toEqual({
      verb: "reported",
      outcome: "done",
      agentDisplay: "Grok Bot",
    });
    expect(boardDoneCall("spike", { statusLabel: "Shipped" }).body).toEqual({
      statusLabel: "Shipped",
    });
    expect(boardDoneCall("spike", { statusLabel: null }).body).toEqual({ statusLabel: null });
    expect(() => boardDoneCall("spike", { statusLabel: `hark_${"a".repeat(43)}` })).toThrow(
      /credential/,
    );
    expect(boardToolSchemas.done.required).toEqual(["key"]);
    expect(boardToolSchemas.done.properties.statusLabel.anyOf).toEqual([
      { type: "string", minLength: 1, maxLength: 60 },
      { type: "null" },
    ]);
    expect(boardNoteCall({ key: "n", text: "Heads up", agentDisplay: "Grok Bot" }).body).toEqual({
      key: "n",
      text: "Heads up",
      agentDisplay: "Grok Bot",
    });
    expect(boardNoteClearCall("n")).toEqual({
      method: "DELETE",
      path: "/api/agent/board/notes/n",
    });
    expect(() => boardWorkCall({ key: "k", title: "T", state: "flying" })).toThrow(/state/);
    expect(() => boardNoteCall({ key: "n", text: "x", agentDisplay: "y".repeat(61) })).toThrow(
      /agentDisplay/,
    );
  });
});

describe("Executor notify payload", () => {
  it("omits unset fields and rejects oncall combined with deviceIds", () => {
    expect(
      notificationPayload({
        body: "Done",
        project: "SHark",
        summary: "Shipped",
        bodyFormat: "markdown",
        appId: "app_abcdefgh",
        agentDisplay: "Grok Bot",
      }),
    ).toEqual({
      body: "Done",
      project: "SHark",
      summary: "Shipped",
      bodyFormat: "markdown",
      appId: "app_abcdefgh",
      agentDisplay: "Grok Bot",
    });
    expect(notificationPayload({ body: "Done" })).toEqual({ body: "Done" });
    expect(() =>
      notificationPayload({ body: "Page", oncall: "ocg_abcdefgh", deviceIds: ["dev_1"] }),
    ).toThrow(/oncall cannot be combined with deviceIds/);
    expect(() => notificationPayload({ body: "x", bodyFormat: "html" })).toThrow(/bodyFormat/);
  });
});

describe("Executor error passthrough", () => {
  async function fail(status: number, body: unknown, headers?: Record<string, string>) {
    return sharkRequest({
      token,
      path: "/api/agent/board/asks/missing",
      fetch: async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json", ...headers },
        }),
    });
  }

  it("passes through status, error text, issues, required scopes, and Retry-After", async () => {
    await expect(fail(404, { error: "Ask not found" })).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("Ask not found"),
    });
    await expect(
      fail(400, {
        error: "Invalid ask",
        issues: [
          { path: ["title"], message: "Must be a single line" },
          { path: ["options", 0, "id"], message: "Option ids use letters, digits, _ and -" },
        ],
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("title: Must be a single line"),
    });
    await expect(
      fail(403, { error: "Insufficient scope", required: ["oncall:write", "not a scope"] }),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("required: oncall:write"),
    });
    await expect(fail(409, { error: "Another agent owns this work key" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Another agent owns this work key"),
    });
    await expect(fail(422, { error: "A new done item needs a title" })).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      fail(429, { error: "Requester rate limit exceeded" }, { "Retry-After": "60" }),
    ).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("Retry-After: 60"),
    });
    await expect(fail(502, { error: "Withdrawal delivery failed" })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("Withdrawal delivery failed"),
    });
  });

  it("drops secrets, the bearer token, and unsafe issue messages", async () => {
    const leaked = `hark_${"b".repeat(43)}`;
    try {
      await fail(400, {
        error: `Invalid ask ${leaked}`,
        issues: [{ path: ["body"], message: `paste ${token} here` }],
        token,
      });
      throw new Error("expected sharkRequest to reject");
    } catch (error) {
      const text = String(error);
      expect(text).not.toContain(leaked);
      expect(text).not.toContain(token);
      expect(text).toContain("body:");
      expect(text).not.toContain("paste");
    }
  });
});

describe("SHARK_ORIGIN", () => {
  it("defaults to production and accepts a loopback override", () => {
    expect(resolveSharkOrigin()).toBe(SHARK_ORIGIN);
    expect(resolveSharkOrigin("http://localhost:8788")).toBe("http://localhost:8788");
    expect(resolveSharkOrigin("https://shark.example")).toBe("https://shark.example");
    expect(() => resolveSharkOrigin("http://example.com")).toThrow(/localhost/);
    expect(() => resolveSharkOrigin("https://user:pass@shark.example")).toThrow(/credentials/);
  });

  it("sends the configured origin without putting the token in the error", async () => {
    let seen = "";
    await sharkRequest({
      token,
      path: "/api/agent/auth/status",
      origin: "http://127.0.0.1:8788",
      fetch: async (input) => {
        seen = input;
        return new Response(JSON.stringify({ authenticated: true }), { status: 200 });
      },
    });
    expect(seen).toBe("http://127.0.0.1:8788/api/agent/auth/status");
  });
});
