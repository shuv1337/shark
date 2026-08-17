import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execute, parseArgs, parseDuration, run } from "../src/cli.mjs";

test("parses repeatable devices and notify ask options", () => {
  const parsed = parseArgs([
    "notify",
    "ask",
    "Deploy production?",
    "--approval",
    "--device",
    "dev_a",
    "--device=dev_b",
    "--expires-in",
    "10m",
    "--wait",
    "--json",
  ]);
  assert.deepEqual(parsed.positionals, ["notify", "ask", "Deploy production?"]);
  assert.deepEqual(parsed.options.device, ["dev_a", "dev_b"]);
  assert.equal(parsed.options.approval, true);
  assert.equal(parsed.options.wait, true);
  assert.equal(parsed.options.json, true);
  assert.equal(parsed.separatorAt, null);
  assert.equal(parseDuration(parsed.options["expires-in"]), 600);
});

test("a bare -- separator turns everything after it into positionals", () => {
  const parsed = parseArgs(["notify", "--", "ask", "--approval"]);
  assert.deepEqual(parsed.positionals, ["notify", "ask", "--approval"]);
  assert.equal(parsed.separatorAt, 1);
});

test("rejects tokens and unknown options on argv", () => {
  assert.throws(() => parseArgs(["auth", "status", "--token", "secret"]), /Unknown option/);
});

test("removed legacy commands and flags are usage errors", async () => {
  assert.throws(
    () => parseArgs(["notify", "ask", "Deploy?", "--reply"]),
    /Unknown option: --reply/,
  );
  assert.throws(
    () => parseArgs(["notify", "ask", "Deploy?", "--approve", "--deny"]),
    /Unknown option: --approve/,
  );
  assert.throws(() => parseArgs(["notify", "Hi", "--prompt", "P"]), /Unknown option: --prompt/);
  await assert.rejects(
    execute(["ask", "Deploy?", "--approval"], { HARK_TOKEN: "hark_test" }),
    /Unknown command/,
  );
});

test("parses duration suffixes", () => {
  assert.equal(parseDuration("30"), 30);
  assert.equal(parseDuration("2m"), 120);
  assert.equal(parseDuration("1.5h"), 5400);
  assert.equal(parseDuration("90d"), 7_776_000);
  assert.throws(() => parseDuration("tomorrow"), /Invalid duration/);
});

test("creates a webhook service with default appearance", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return Response.json(
      {
        service: {
          id: "svc_test",
          title: "Release bot",
          imageUrl: "https://example.com/bot.png",
          url: null,
        },
        webhookUrl: "https://example.test/hooks/hook_secret",
      },
      { status: 201 },
    );
  };
  try {
    const result = await execute(
      ["services", "create", "--title", "Release bot", "--image", "https://example.com/bot.png"],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.webhookUrl, "https://example.test/hooks/hook_secret");
    assert.equal(request.url, "https://example.test/api/agent/services");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(JSON.parse(request.init.body), {
      title: "Release bot",
      imageUrl: "https://example.com/bot.png",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth login polls through pending and slow_down without opening a non-TTY browser", async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "sharkctl-login-"));
  const path = join(directory, "config.json");
  const deviceCode = "d".repeat(43);
  const accessToken = `hark_${"s".repeat(43)}`;
  const calls = [];
  const sleeps = [];
  let opened = 0;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/start")) {
      assert.equal(init.headers.authorization, undefined);
      assert.deepEqual(JSON.parse(init.body), {
        clientName: "CI agent",
        scopes: ["interactions:read"],
        expiresInSeconds: 3600,
      });
      return Response.json(
        {
          deviceCode,
          userCode: "ABCD-EFGH",
          verificationUri: "https://example.test/cli/authorize",
          verificationUriComplete: "https://example.test/cli/authorize?code=ABCD-EFGH",
          expiresIn: 600,
          interval: 5,
        },
        { status: 201 },
      );
    }
    const pollNumber = calls.filter(({ url: value }) => value.endsWith("/token")).length;
    assert.equal(init.headers.authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), { deviceCode });
    if (pollNumber === 1) {
      return Response.json({ error: "authorization_pending", interval: 5 }, { status: 400 });
    }
    if (pollNumber === 2) {
      return Response.json({ error: "slow_down", interval: 10 }, { status: 400 });
    }
    return Response.json({
      accessToken,
      token: {
        id: "tok_login",
        name: "CI agent",
        prefix: "hark_ssssssss",
        scopes: ["interactions:read"],
      },
    });
  };
  try {
    const result = await execute(
      [
        "auth",
        "login",
        "--json",
        "--client-name",
        "CI agent",
        "--scope",
        "interactions:read",
        "--expires-in",
        "1h",
      ],
      { HARK_API_URL: "https://example.test", HARK_CONFIG: path },
      {
        openBrowser: () => {
          opened += 1;
        },
        sleep: async (milliseconds) => sleeps.push(milliseconds),
        stderr: () => {},
        stderrIsTTY: false,
      },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(opened, 0);
    assert.deepEqual(sleeps, [5000, 5000, 10000]);
    assert.equal(JSON.stringify(result.body).includes(accessToken), false);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      apiUrl: "https://example.test",
      token: accessToken,
      tokenId: "tok_login",
    });
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("auth login opens only when interactive or explicitly requested", async () => {
  const originalFetch = globalThis.fetch;
  let opened = 0;
  const mockFetch = async (url, init) => {
    if (String(url).endsWith("/start")) {
      assert.equal(JSON.parse(init.body).clientName, "sharkctl");
      return Response.json(
        {
          deviceCode: "o".repeat(43),
          userCode: "OPEN-2345",
          verificationUri: "https://example.test/cli/authorize",
          verificationUriComplete: "https://example.test/cli/authorize?code=OPEN-2345",
          expiresIn: 600,
          interval: 5,
        },
        { status: 201 },
      );
    }
    return Response.json({
      accessToken: `hark_${"o".repeat(43)}`,
      token: { id: "tok_open", name: "sharkctl", prefix: "hark_oooooooo", scopes: [] },
    });
  };
  globalThis.fetch = mockFetch;
  try {
    const overrides = {
      openBrowser: () => {
        opened += 1;
      },
      sleep: async () => {},
      stderr: () => {},
      stderrIsTTY: false,
      writeConfig: async () => {},
    };
    await execute(["auth", "login", "--open"], {}, overrides);
    assert.equal(opened, 1);
    await execute(["auth", "login", "--no-open"], {}, { ...overrides, stderrIsTTY: true });
    assert.equal(opened, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth login maps denied and expired terminal responses", async () => {
  const originalFetch = globalThis.fetch;
  const terminal = async (error) => {
    globalThis.fetch = async (url) =>
      String(url).endsWith("/start")
        ? Response.json(
            {
              deviceCode: "t".repeat(43),
              userCode: "TERM-2345",
              verificationUri: "https://example.test/cli/authorize",
              verificationUriComplete: "https://example.test/cli/authorize?code=TERM-2345",
              expiresIn: 600,
              interval: 5,
            },
            { status: 201 },
          )
        : Response.json({ error }, { status: 400 });
    const stdout = [];
    const stderr = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (value) => stdout.push(value);
    console.error = (value) => stderr.push(value);
    try {
      const code = await run(
        ["auth", "login", "--json"],
        {},
        {
          sleep: async () => {},
          stderrIsTTY: false,
          writeConfig: async () => {},
        },
      );
      assert.equal(stdout.length, 0);
      return code;
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  };
  try {
    assert.equal(await terminal("access_denied"), 5);
    assert.equal(await terminal("expired_token"), 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth login emits one safe JSON object and keeps both secrets out of output", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  const deviceCode = "z".repeat(43);
  const accessToken = `hark_${"z".repeat(43)}`;
  globalThis.fetch = async (url) =>
    String(url).endsWith("/start")
      ? Response.json(
          {
            deviceCode,
            userCode: "SAFE-2345",
            verificationUri: "https://example.test/cli/authorize",
            verificationUriComplete: "https://example.test/cli/authorize?code=SAFE-2345",
            expiresIn: 600,
            interval: 5,
          },
          { status: 201 },
        )
      : Response.json({
          accessToken,
          token: { id: "tok_safe", name: "sharkctl", prefix: "hark_zzzzzzzz", scopes: [] },
        });
  console.log = (value) => stdout.push(value);
  console.error = (value) => stderr.push(value);
  try {
    const exitCode = await run(
      ["auth", "login", "--json"],
      {},
      {
        sleep: async () => {},
        stderrIsTTY: false,
        writeConfig: async () => {},
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(stdout.length, 1);
    assert.equal(stderr.length, 2);
    JSON.parse(stdout[0]);
    assert.equal([...stdout, ...stderr].join("\n").includes(deviceCode), false);
    assert.equal([...stdout, ...stderr].join("\n").includes(accessToken), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("auth logout revokes before removing file credentials", async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "sharkctl-logout-"));
  const path = join(directory, "config.json");
  const token = `hark_${"r".repeat(43)}`;
  await writeFile(path, JSON.stringify({ token, apiUrl: "https://example.test" }), { mode: 0o600 });
  await chmod(path, 0o600);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.test/api/agent/auth/revoke");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    return Response.json({ ok: true });
  };
  try {
    const result = await execute(["auth", "logout"], { HARK_CONFIG: path });
    assert.deepEqual(result.body, {
      authenticated: false,
      revoked: true,
      credentialsRemoved: true,
    });
    await assert.rejects(stat(path), { code: "ENOENT" });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("auth status emits one safe JSON object without token metadata", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  const sensitivePrefix = "synthetic_prefix_must_not_escape";
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers.authorization, "Bearer hark_test");
    return new Response(
      JSON.stringify({
        authenticated: true,
        token: {
          id: "synthetic_token_id",
          name: "Synthetic connection",
          prefix: sensitivePrefix,
          scopes: ["notifications:send"],
          createdAt: "2026-08-10T00:00:00.000Z",
          lastUsedAt: "2026-08-10T00:01:00.000Z",
          expiresAt: null,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  console.log = (value) => stdout.push(value);
  console.error = (value) => stderr.push(value);
  try {
    assert.equal(await run(["auth", "status"], { HARK_TOKEN: "hark_test" }), 0);
    assert.deepEqual(JSON.parse(stdout[0]), { authenticated: true });
    assert.equal(stdout[0].includes(sensitivePrefix), false);
    assert.equal(stdout.length, 1);
    assert.equal(stderr.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("notify sends the normalized notification request body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.test/api/agent/notifications");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], "deploy-done-1");
    assert.deepEqual(JSON.parse(init.body), {
      body: "Deploy finished",
      title: "Release",
      imageUrl: "https://example.com/bot.png",
      url: "https://example.com/run/1",
      deviceIds: ["dev_a", "dev_b"],
    });
    return Response.json(
      { accepted: 2, notification: { id: "anot_1", title: "Release", body: "Deploy finished" } },
      { status: 201 },
    );
  };
  try {
    const result = await execute(
      [
        "notify",
        "Deploy finished",
        "--title",
        "Release",
        "--image",
        "https://example.com/bot.png",
        "--url",
        "https://example.com/run/1",
        "--device",
        "dev_a",
        "--device",
        "dev_b",
        "--idempotency-key",
        "deploy-done-1",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.notification.id, "anot_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify merges --stdin JSON under explicit flags and exits 7 when nothing is accepted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { body: "Anyone there?" });
    return Response.json(
      { accepted: 0, notification: { id: "anot_none" }, message: "…" },
      {
        status: 201,
      },
    );
  };
  try {
    const result = await execute(["notify", "Anyone there?"], { HARK_TOKEN: "hark_test" });
    assert.equal(result.exitCode, 7);
    assert.equal(result.body.accepted, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify -- ask sends the literal body ask instead of the subcommand", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ accepted: 1, notification: { id: "anot_ask" } }, { status: 201 });
  };
  try {
    const result = await execute(["notify", "--", "ask"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, [
      {
        url: "https://example.test/api/agent/notifications",
        body: { body: "ask" },
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask sends the normalized approval request body with an image", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.test/api/agent/interactions");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], "deploy-1");
    assert.deepEqual(JSON.parse(init.body), {
      title: "Release",
      prompt: "Deploy production?",
      kind: "approval",
      expiresInSeconds: 600,
      imageUrl: "https://example.com/bot.png",
      deviceIds: ["dev_a"],
    });
    return Response.json({
      accepted: 1,
      interaction: { id: "int_1", status: "pending", actionDigest: "a".repeat(64) },
    });
  };
  try {
    const result = await execute(
      [
        "notify",
        "ask",
        "Deploy production?",
        "--approval",
        "--title",
        "Release",
        "--image",
        "https://example.com/bot.png",
        "--device",
        "dev_a",
        "--expires-in",
        "10m",
        "--idempotency-key",
        "deploy-1",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.interaction.actionDigest, "a".repeat(64));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask sends an interactive Live Activity with cosmetic labels", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      title: "Release",
      prompt: "Send the prepared release email?",
      kind: "approval",
      expiresInSeconds: 900,
      presentation: "live_activity",
      primaryLabel: "Send",
      secondaryLabel: "Deny",
    });
    return Response.json({
      accepted: 1,
      liveActivityId: "act_1",
      interaction: { id: "int_live", status: "pending" },
    });
  };
  try {
    const result = await execute(
      [
        "notify",
        "ask",
        "Send the prepared release email?",
        "--approval",
        "--title",
        "Release",
        "--live-activity",
        "--primary-label",
        "Send",
        "--secondary-label",
        "Deny",
      ],
      { HARK_TOKEN: "hark_test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.liveActivityId, "act_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask rejects unsupported Live Activity response shapes", async () => {
  await assert.rejects(
    execute(["notify", "ask", "Write a reply", "--text", "--live-activity"], {
      HARK_TOKEN: "hark_test",
    }),
    /supports --approval or --yes-no/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--primary-label", "Deploy"], {
      HARK_TOKEN: "hark_test",
    }),
    /labels require --live-activity/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--live-activity", "--expires-in", "9h"], {
      HARK_TOKEN: "hark_test",
    }),
    /expire within 8 hours/,
  );
});

test("notify ask --text maps to a reply interaction and defaults the title", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      title: "SHark",
      prompt: "What should the release note say?",
      kind: "reply",
      expiresInSeconds: 900,
    });
    return Response.json({ accepted: 1, interaction: { id: "int_text", status: "pending" } });
  };
  try {
    const result = await execute(["notify", "ask", "What should the release note say?", "--text"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask requires exactly one response type", async () => {
  await assert.rejects(
    execute(["notify", "ask", "Deploy?"], { HARK_TOKEN: "hark_test" }),
    /exactly one response type/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--text"], { HARK_TOKEN: "hark_test" }),
    /exactly one response type/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--yes-no", "--approval"], { HARK_TOKEN: "hark_test" }),
    /exactly one response type/,
  );
});

test("notify ask --yes-no maps to a yes_no interaction and a no answer exits 5", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/agent/interactions")) {
      assert.equal(JSON.parse(init.body).kind, "yes_no");
      return Response.json({ accepted: 1, interaction: { id: "int_yn", status: "pending" } });
    }
    assert.match(String(url), /\/api\/agent\/interactions\/int_yn\/wait\?timeout=/);
    return Response.json({ interaction: { id: "int_yn", status: "no" } });
  };
  try {
    const result = await execute(
      ["notify", "ask", "Keep the current color?", "--yes-no", "--wait", "--timeout", "30s"],
      { HARK_TOKEN: "hark_test" },
    );
    assert.equal(result.exitCode, 5);
    assert.equal(result.body.interaction.status, "no");

    globalThis.fetch = async (url) => {
      assert.match(String(url), /\/api\/agent\/interactions\/int_yes$/);
      return Response.json({ interaction: { id: "int_yes", status: "yes" } });
    };
    const affirmative = await execute(["interaction", "get", "int_yes"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(affirmative.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask without wait preserves JSON body and exits 7 when no push is accepted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ accepted: 0, interaction: { id: "int_none", status: "pending" } });
  try {
    const result = await execute(["notify", "ask", "Anyone there?", "--text"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 7);
    assert.equal(result.body.accepted, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask with wait exits 7 without making a wait request when no push is accepted", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ accepted: 0, interaction: { id: "int_none_wait", status: "pending" } });
  };
  try {
    const result = await execute(["notify", "ask", "Anyone there?", "--text", "--wait"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 7);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask --poll caps the wait at 20 seconds and maps a pending answer to exit 4", async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith("/api/agent/interactions")) {
      return Response.json({ accepted: 1, interaction: { id: "int_poll", status: "pending" } });
    }
    return Response.json({ interaction: { id: "int_poll", status: "pending" }, timedOut: true });
  };
  const ticks = [0, 0, 20_001];
  try {
    const result = await execute(
      ["notify", "ask", "Deploy?", "--approval", "--poll"],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
      { now: () => (ticks.length > 1 ? ticks.shift() : ticks[0]) },
    );
    assert.equal(result.exitCode, 4);
    assert.equal(result.body.timedOut, true);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /\/api\/agent\/interactions\/int_poll\/wait\?timeout=20$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask --poll returns an instant terminal answer with wait exit codes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith("/api/agent/interactions")
      ? Response.json({ accepted: 1, interaction: { id: "int_fast", status: "pending" } })
      : Response.json({ interaction: { id: "int_fast", status: "denied" }, timedOut: false });
  try {
    const result = await execute(["notify", "ask", "Deploy?", "--approval", "--poll"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 5);
    assert.equal(result.body.interaction.status, "denied");
    assert.equal(result.body.timedOut, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask rejects --poll combined with --wait or --timeout", async () => {
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--poll", "--wait"], {
      HARK_TOKEN: "hark_test",
    }),
    /--poll cannot be combined/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--poll", "--timeout", "5s"], {
      HARK_TOKEN: "hark_test",
    }),
    /--poll cannot be combined/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--timeout", "5s"], {
      HARK_TOKEN: "hark_test",
    }),
    /--timeout requires --wait/,
  );
});

test("wait returns terminal status and timeout zero still returns a defined body", async () => {
  const originalFetch = globalThis.fetch;
  let terminal = true;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/wait\?timeout=/);
    return Response.json({
      interaction: { id: "int_wait", status: terminal ? "approved" : "pending" },
      timedOut: !terminal,
    });
  };
  try {
    const approved = await execute(["interaction", "wait", "int_wait", "--timeout", "1s"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(approved.exitCode, 0);
    assert.equal(approved.body.interaction.status, "approved");

    terminal = false;
    const timedOut = await execute(["interaction", "wait", "int_wait", "--timeout", "0"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(timedOut.exitCode, 4);
    assert.equal(timedOut.body.interaction.status, "pending");
    assert.equal(timedOut.body.timedOut, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity start sends normalized finite progress and routing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://example.test/api/agent/activities");
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Idempotency-Key"], "build-start-1");
    assert.deepEqual(JSON.parse(init.body), {
      title: "Build release",
      status: "Compiling",
      key: "release-main",
      replace: true,
      detail: "Web target",
      progress: 0.25,
      symbol: "build",
      privacyMode: "private",
      accentColor: "#FF9F0A",
      style: "ring",
      deviceIds: ["dev_a", "dev_b"],
      expiresInSeconds: 3600,
      staleAfterSeconds: 300,
    });
    return Response.json({ accepted: 2, failed: 0, activity: { id: "act_1", sequence: 0 } });
  };
  try {
    const result = await execute(
      [
        "activity",
        "start",
        "--title",
        "Build release",
        "--status",
        "Compiling",
        "--key",
        "release-main",
        "--replace",
        "--detail",
        "Web target",
        "--progress",
        "0.25",
        "--symbol",
        "build",
        "--privacy",
        "private",
        "--accent-color",
        "#FF9F0A",
        "--style",
        "ring",
        "--device",
        "dev_a",
        "--device",
        "dev_b",
        "--expires-in",
        "1h",
        "--stale-after",
        "5m",
        "--idempotency-key",
        "build-start-1",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.activity.sequence, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity update and end send sequence preconditions", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({
      accepted: 1,
      failed: 0,
      activity: { id: "act_1", sequence: calls.length },
    });
  };
  try {
    await execute(
      [
        "activity",
        "update",
        "act_1",
        "--status",
        "Testing",
        "--progress",
        "0.7",
        "--if-sequence",
        "2",
        "--accent-color",
        "#64D2FF",
        "--style",
        "hero",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    await execute(
      [
        "activity",
        "end",
        "--key",
        "release-main",
        "--status",
        "Complete",
        "--progress",
        "1",
        "--dismiss-after",
        "30s",
        "--if-sequence",
        "3",
        "--accent-color",
        "#5ED8B7",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      status: "Testing",
      progress: 0.7,
      accentColor: "#64D2FF",
      style: "hero",
      ifSequence: 2,
    });
    assert.equal(calls[0].init.method, "PATCH");
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      status: "Complete",
      progress: 1,
      accentColor: "#5ED8B7",
      dismissAfterSeconds: 30,
      ifSequence: 3,
    });
    assert.match(calls[1].url, /release-main\/end$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity CLI rejects invalid progress and preserves no-delivery exit behavior", async () => {
  await assert.rejects(
    execute(["activity", "start", "--title", "Task", "--status", "Run", "--progress", "2"], {
      HARK_TOKEN: "hark_test",
    }),
    /progress/,
  );
  await assert.rejects(
    execute(
      ["activity", "start", "--title", "Task", "--status", "Run", "--accent-color", "orange"],
      { HARK_TOKEN: "hark_test" },
    ),
    /accent-color/,
  );
  await assert.rejects(
    execute(["activity", "start", "--title", "Task", "--status", "Run", "--style", "neon"], {
      HARK_TOKEN: "hark_test",
    }),
    /--style must be one of: standard, ring, hero, terminal, steps/,
  );
  await assert.rejects(
    execute(["activity", "update", "act_1", "--style", "neon"], { HARK_TOKEN: "hark_test" }),
    /--style must be one of/,
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ accepted: 0, failed: 1, activity: { id: "act_none", sequence: 0 } });
  try {
    const result = await execute(["activity", "start", "--title", "Task", "--status", "Run"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(result.exitCode, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects group-readable config files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sharkctl-"));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify({ token: "hark_test" }));
  await chmod(path, 0o640);
  try {
    await assert.rejects(execute(["auth", "status"], { HARK_CONFIG: path }), /mode 0600/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
