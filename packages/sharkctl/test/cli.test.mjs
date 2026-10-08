import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  execute,
  formatRequestError,
  parseArgs,
  parseDuration,
  RequestError,
  run,
} from "../src/cli.mjs";

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

test("notify sends project, summary, and body format metadata", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), {
      body: "Deploy finished with a very long report",
      project: "Acme App",
      summary: "Deploy finished",
      bodyFormat: "markdown",
    });
    return Response.json({ accepted: 1, notification: { id: "anot_prj" } }, { status: 201 });
  };
  try {
    const result = await execute(
      [
        "notify",
        "Deploy finished with a very long report",
        "--project",
        "Acme App",
        "--summary",
        "Deploy finished",
        "--markdown",
      ],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify --body-format validates values and conflicts with --markdown text", async () => {
  await assert.rejects(
    execute(["notify", "Hi", "--body-format", "html"], { HARK_TOKEN: "hark_test" }),
    /--body-format must be text or markdown/,
  );
  await assert.rejects(
    execute(["notify", "Hi", "--markdown", "--body-format", "text"], {
      HARK_TOKEN: "hark_test",
    }),
    /--markdown conflicts with --body-format text/,
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(init.body).bodyFormat, "markdown");
    return Response.json({ accepted: 1, notification: { id: "anot_md" } }, { status: 201 });
  };
  try {
    const result = await execute(["notify", "Hi", "--body-format", "markdown"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify bounds bodies to the server limits before sending", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ accepted: 1, notification: { id: "anot_big" } }, { status: 201 });
  };
  try {
    // 8,001 characters: over the character cap without any request.
    await assert.rejects(
      execute(["notify", "x".repeat(8001)], {
        HARK_TOKEN: "hark_test",
        HARK_API_URL: "https://example.test",
      }),
      /at most 8000 characters/,
    );
    // 6,000 three-byte glyphs: 18,000 bytes of UTF-8, over the byte cap.
    await assert.rejects(
      execute(["notify", "気".repeat(6000)], {
        HARK_TOKEN: "hark_test",
        HARK_API_URL: "https://example.test",
      }),
      /16384 bytes/,
    );
    assert.equal(requests, 0);
    // Exactly at the caps still sends, including via --stdin merge.
    const atLimit = await execute(["notify", "x".repeat(8000)], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(atLimit.exitCode, 0);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask rejects the notify-only project and format flags", async () => {
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--project", "Acme"], {
      HARK_TOKEN: "hark_test",
    }),
    /apply to notify, not notify ask/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--markdown"], {
      HARK_TOKEN: "hark_test",
    }),
    /apply to notify, not notify ask/,
  );
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
      style: "signal",
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
        "--style",
        "signal",
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
    execute(["notify", "ask", "Deploy?", "--approval", "--style", "signal"], {
      HARK_TOKEN: "hark_test",
    }),
    /style requires --live-activity/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--live-activity", "--style", "neon"], {
      HARK_TOKEN: "hark_test",
    }),
    /approval, shell, verdict, signal/,
  );
  await assert.rejects(
    execute(["notify", "ask", "Deploy?", "--approval", "--live-activity", "--expires-in", "9h"], {
      HARK_TOKEN: "hark_test",
    }),
    /expire within 8 hours/,
  );
});

test("notify ask derives the interaction expiry from --timeout when no expiry is explicit", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/agent/interactions")) {
      assert.equal(JSON.parse(init.body).expiresInSeconds, 5400);
      return Response.json({ accepted: 1, interaction: { id: "int_derive", status: "pending" } });
    }
    return Response.json({ interaction: { id: "int_derive", status: "replied", response: "ok" } });
  };
  try {
    const result = await execute(
      ["notify", "ask", "Deploy?", "--text", "--wait", "--timeout", "90m"],
      { HARK_TOKEN: "hark_test" },
    );
    assert.equal(result.exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask clamps a derived expiry to the server range of 30 seconds through 24 hours", async () => {
  const originalFetch = globalThis.fetch;
  const expiries = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/agent/interactions")) {
      expiries.push(JSON.parse(init.body).expiresInSeconds);
      return Response.json({ accepted: 1, interaction: { id: "int_clamp", status: "pending" } });
    }
    return Response.json({ interaction: { id: "int_clamp", status: "replied", response: "ok" } });
  };
  try {
    const short = await execute(
      ["notify", "ask", "Deploy?", "--text", "--wait", "--timeout", "10s"],
      { HARK_TOKEN: "hark_test" },
    );
    assert.equal(short.exitCode, 0);
    const long = await execute(
      ["notify", "ask", "Deploy?", "--text", "--wait", "--timeout", "48h"],
      { HARK_TOKEN: "hark_test" },
    );
    assert.equal(long.exitCode, 0);
    assert.deepEqual(expiries, [30, 86_400]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask clamps a derived Live Activity expiry to 8 hours via flag or stdin presentation", async () => {
  const originalFetch = globalThis.fetch;
  const expiries = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/agent/interactions")) {
      expiries.push(JSON.parse(init.body).expiresInSeconds);
      return Response.json({ accepted: 1, interaction: { id: "int_la_clamp", status: "pending" } });
    }
    return Response.json({
      interaction: { id: "int_la_clamp", status: "replied", response: "ok" },
    });
  };
  try {
    const flagged = await execute(
      ["notify", "ask", "Deploy?", "--approval", "--live-activity", "--wait", "--timeout", "12h"],
      { HARK_TOKEN: "hark_test" },
    );
    assert.equal(flagged.exitCode, 0);
    const fromStdin = await execute(
      ["notify", "ask", "Deploy?", "--approval", "--stdin", "--wait", "--timeout", "9h"],
      { HARK_TOKEN: "hark_test" },
      { stdin: [JSON.stringify({ prompt: "Deploy?", presentation: "live_activity" })] },
    );
    assert.equal(fromStdin.exitCode, 0);
    assert.deepEqual(expiries, [28_800, 28_800]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask keeps explicit flag and stdin expiry ahead of timeout derivation", async () => {
  const originalFetch = globalThis.fetch;
  const warnings = [];
  const expiries = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/api/agent/interactions")) {
      expiries.push(JSON.parse(init.body).expiresInSeconds);
      return Response.json({ accepted: 1, interaction: { id: "int_explicit", status: "pending" } });
    }
    return Response.json({
      interaction: { id: "int_explicit", status: "replied", response: "ok" },
    });
  };
  try {
    // A long --timeout with an explicit shorter expiry warns instead of deriving.
    const flagged = await execute(
      ["notify", "ask", "Deploy?", "--text", "--wait", "--expires-in", "5m", "--timeout", "90m"],
      { HARK_TOKEN: "hark_test" },
      { stderr: (message) => warnings.push(message) },
    );
    assert.equal(flagged.exitCode, 0);

    // stdin.expiresIn counts as explicit and suppresses derivation.
    const fromStdin = await execute(
      ["notify", "ask", "Deploy?", "--text", "--stdin", "--wait", "--timeout", "90m"],
      { HARK_TOKEN: "hark_test" },
      {
        stdin: [JSON.stringify({ expiresIn: "5m" })],
        stderr: (message) => warnings.push(message),
      },
    );
    assert.equal(fromStdin.exitCode, 0);

    // --expires-in overrides stdin.expiresIn.
    const both = await execute(
      [
        "notify",
        "ask",
        "Deploy?",
        "--text",
        "--stdin",
        "--expires-in",
        "10m",
        "--wait",
        "--timeout",
        "90m",
      ],
      { HARK_TOKEN: "hark_test" },
      {
        stdin: [JSON.stringify({ expiresIn: "5m" })],
        stderr: (message) => warnings.push(message),
      },
    );
    assert.equal(both.exitCode, 0);

    assert.deepEqual(expiries, [300, 300, 600]);
    assert.equal(warnings.length, 3);
    for (const warning of warnings) {
      assert.match(warning, /exceeds the interaction expiry/);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notify ask derived expiry does not warn and --poll keeps its default expiry behavior", async () => {
  const originalFetch = globalThis.fetch;
  const warnings = [];
  const expiries = [];
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    if (String(url).endsWith("/api/agent/interactions")) {
      expiries.push(JSON.parse(init.body).expiresInSeconds);
      return Response.json({ accepted: 1, interaction: { id: "int_nowarn", status: "pending" } });
    }
    return Response.json({ interaction: { id: "int_nowarn", status: "replied", response: "ok" } });
  };
  try {
    // A derived expiry equals the timeout, so waiting beyond expiry is impossible
    // and no warning is emitted.
    const derived = await execute(
      ["notify", "ask", "Deploy?", "--text", "--wait", "--timeout", "30s"],
      { HARK_TOKEN: "hark_test" },
      { stderr: (message) => warnings.push(message) },
    );
    assert.equal(derived.exitCode, 0);
    assert.deepEqual(expiries, [30]);
    assert.deepEqual(warnings, []);

    // --poll without an explicit expiry still defaults the prompt to 15 minutes.
    const polled = await execute(["notify", "ask", "Deploy?", "--approval", "--poll"], {
      HARK_TOKEN: "hark_test",
    });
    assert.equal(polled.exitCode, 0);
    assert.match(urls.at(-1), /\/wait\?timeout=20$/);
    assert.deepEqual(expiries, [30, 900]);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("activity update accepts status alone and status with progress", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ accepted: 1, failed: 0, activity: { id: "act_1", sequence: 1 } });
  };
  try {
    const statusOnly = await execute(["activity", "update", "act_1", "--status", "Testing"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    const withProgress = await execute(
      ["activity", "update", "release-main", "--status", "Testing", "--progress", "0.7"],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(statusOnly.exitCode, 0);
    assert.equal(withProgress.exitCode, 0);
    assert.deepEqual(bodies, [{ status: "Testing" }, { status: "Testing", progress: 0.7 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity update and end print field issues once and never echo submitted values", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const end = String(url).endsWith("/end");
    return Response.json(
      {
        error: end ? "Invalid Live Activity end" : "Invalid Live Activity update",
        diagnostic: end
          ? "rejected field progress: Number must be less than or equal to 1"
          : "rejected field progress: Invalid input: expected number, received string; rejected field activity: unrecognized",
        issues: end
          ? [
              {
                path: ["progress"],
                message: "Number must be less than or equal to 1",
                received: "hark_should_not_print",
              },
              { path: ["symbol"], message: "Invalid option" },
              { path: [], message: "object-level constraint" },
              { path: ["detail"], message: "too long\nnext line" },
              "ignore me",
              { path: ["status"], message: { leaked: "hark_nested" } },
            ]
          : [
              {
                path: ["status"],
                message: "Too big: expected string to have <=60 characters",
              },
              {
                path: ["progress"],
                message: "Invalid input: expected number, received string",
              },
              { path: [], message: "At least one activity field is required" },
              { path: ["steps", 0, "label"], message: "Required" },
              "unstructured issue",
              { path: ["symbol"] },
            ],
      },
      { status: 400 },
    );
  };
  console.log = (value) => stdout.push(value);
  console.error = (value) => stderr.push(value);
  try {
    const updated = await run(
      ["activity", "update", "act_1", "--status", "Testing", "--progress", "0.4"],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(updated, 1);
    assert.equal(
      stderr[0],
      [
        "Invalid Live Activity update",
        "status: Too big: expected string to have <=60 characters",
        "progress: Invalid input: expected number, received string",
        "At least one activity field is required",
        "steps.0.label: Required",
        "activity: unrecognized",
      ].join("\n"),
    );
    assert.equal(stderr[0].includes("rejected field progress"), false);

    stderr.length = 0;
    const ended = await run(
      ["activity", "end", "deploy-main", "--status", "Shipped", "--progress", "2"],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(ended, 1);
    assert.equal(stdout.length, 0);
    assert.equal(
      stderr[0],
      [
        "Invalid Live Activity end",
        "progress: Number must be less than or equal to 1",
        "symbol: Invalid option",
        "object-level constraint",
        "detail: too long next line",
      ].join("\n"),
    );
    assert.equal(stderr[0].includes("hark_should_not_print"), false);
    assert.equal(stderr[0].includes("hark_nested"), false);
    assert.match(calls[1].url, /\/api\/agent\/activities\/deploy-main\/end$/);

    calls.length = 0;
    stderr.length = 0;
    const byKey = await run(["activity", "end", "--key", "release-main"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(byKey, 1);
    assert.match(calls[0].url, /\/api\/agent\/activities\/release-main\/end$/);
    assert.match(stderr[0], /^Invalid Live Activity end\nprogress:/);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("activity update explains an empty update locally", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({ accepted: 1 });
  };
  try {
    await assert.rejects(
      execute(["activity", "update", "act_1", "--if-sequence", "1"], { HARK_TOKEN: "hark_test" }),
      /activity update requires at least one of --title, --status, --detail, --progress/,
    );
    const usage = await run(["activity", "update", "act_1"], { HARK_TOKEN: "hark_test" });
    assert.equal(usage, 2);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("request errors without field issues stay a single line", () => {
  const error = new RequestError("Live Activity not found", 404, {
    error: "Live Activity not found",
  });
  assert.equal(formatRequestError(error), "Live Activity not found");
  assert.equal(formatRequestError(new Error("Unexpected error")), "Unexpected error");
  assert.equal(
    formatRequestError(new RequestError("Invalid Live Activity end", 400, { issues: "nope" })),
    "Invalid Live Activity end",
  );
});

test("activity update prints one terminal status line", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  const responses = [
    {
      status: 409,
      body: {
        error: "Live Activity is already terminal (ended)",
        status: "ended",
        endedAt: "2026-08-28T12:10:00.000Z",
        expiresAt: "2026-08-28T20:00:00.000Z",
        diagnostic: "rejected state: ended",
        activity: {
          id: "act_ended",
          status: "ended",
          endedAt: "2026-08-28T12:10:00.000Z",
          expiresAt: "2026-08-28T20:00:00.000Z",
          props: { title: "should-not-print" },
        },
      },
    },
    {
      status: 409,
      body: {
        error: "Live Activity is already terminal",
        activity: { id: "act_expired", status: "expired", props: { status: "Pushing" } },
      },
    },
  ];
  globalThis.fetch = async () => {
    const next = responses.shift();
    return Response.json(next.body, { status: next.status });
  };
  console.log = (value) => stdout.push(value);
  console.error = (value) => stderr.push(value);
  try {
    const ended = await run(["activity", "update", "act_ended", "--status", "Testing"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(ended, 1);
    assert.deepEqual(stdout, []);
    assert.deepEqual(stderr, [
      "Live Activity is already terminal (ended)\nstatus=ended endedAt=2026-08-28T12:10:00.000Z expiresAt=2026-08-28T20:00:00.000Z",
    ]);
    assert.equal(stderr.join("\n").includes("should-not-print"), false);
    assert.equal(stderr.join("\n").includes("rejected state"), false);

    const expired = await run(
      ["activity", "update", "act_expired", "--status", "Pushing", "--progress", "0.4"],
      { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" },
    );
    assert.equal(expired, 1);
    assert.equal(
      stderr.at(-1),
      "Live Activity is already terminal (expired)\nstatus=expired endedAt=null expiresAt=null",
    );
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});

test("activity update and end exit 0 when the stored transition is waiting on an update token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      accepted: 0,
      failed: 1,
      message: "MissingUpdateToken",
      updateTokenPending: true,
      activity: { id: "act_1", status: "partial", sequence: 1 },
    });
  try {
    const updated = await execute(["activity", "update", "act_1", "--status", "Testing"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    const ended = await execute(["activity", "end", "act_1", "--status", "Complete"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(updated.exitCode, 0);
    assert.equal(updated.body.updateTokenPending, true);
    assert.equal(ended.exitCode, 0);
    assert.equal(ended.body.message, "MissingUpdateToken");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity update and end still exit 7 when the push is rejected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      accepted: 0,
      failed: 1,
      message: "Unavailable",
      activity: { id: "act_1", status: "ended", sequence: 1 },
    });
  try {
    const updated = await execute(["activity", "update", "act_1", "--status", "Testing"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    const ended = await execute(["activity", "end", "act_1", "--status", "Complete"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    const started = await execute(["activity", "start", "--title", "Task", "--status", "Run"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(updated.exitCode, 7);
    assert.equal(ended.exitCode, 7);
    assert.equal(started.exitCode, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("activity update and end exit 7 when every delivery was already failed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      accepted: 0,
      failed: 0,
      activity: { id: "act_1", status: "ended", sequence: 2 },
    });
  try {
    const updated = await execute(["activity", "update", "act_1", "--status", "Testing"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    const ended = await execute(["activity", "end", "act_1", "--status", "Complete"], {
      HARK_TOKEN: "hark_test",
      HARK_API_URL: "https://example.test",
    });
    assert.equal(updated.exitCode, 7);
    assert.equal(updated.body.updateTokenPending, undefined);
    assert.equal(ended.exitCode, 7);
    assert.equal(ended.body.updateTokenPending, undefined);
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

test("help lists permission bridge commands", async () => {
  const result = await execute(["--help"]);
  assert.match(result.body.help, /permissions setup/);
  assert.match(result.body.help, /permissions uninstall/);
  assert.match(result.body.help, /permissions doctor/);
  assert.match(result.body.help, /--status alone is a valid update/);
});

test("permissions doctor reads scopes in process without printing token metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "sharkctl-permissions-"));
  const path = join(home, "config.json");
  await writeFile(
    path,
    JSON.stringify({ token: "hark_file_fixture", apiUrl: "https://file.example.test" }),
    { mode: 0o600 },
  );
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const stdout = [];
  const sensitivePrefix = "synthetic_prefix_must_not_escape";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://file.example.test/api/agent/auth/status");
    assert.equal(init.headers.authorization, "Bearer hark_file_fixture");
    return Response.json({
      authenticated: true,
      token: {
        id: "synthetic_token_id",
        name: "Synthetic connection",
        prefix: sensitivePrefix,
        scopes: ["notifications:send", "interactions:create"],
      },
    });
  };
  console.log = (value) => stdout.push(value);
  try {
    assert.equal(
      await run(["permissions", "doctor"], {
        HARK_TOKEN: "hark_environment_fixture",
        HARK_API_URL: "https://environment.example.test",
        HARK_CONFIG: path,
        HOME: home,
      }),
      0,
    );
    const body = JSON.parse(stdout[0]);
    assert.equal(body.authenticated, true);
    assert.deepEqual(body.missingScopes, ["interactions:read"]);
    assert.equal(body.token, undefined);
    assert.equal(body.scopes, undefined);
    assert.equal(stdout[0].includes(sensitivePrefix), false);
    assert.deepEqual(body.installed, {
      claude: false,
      codex: false,
      opencode: { v1: false, v2: false },
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    await rm(home, { recursive: true, force: true });
  }
});

test("permission setup and doctor reject environment-only credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "sharkctl-permissions-"));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({
      authenticated: true,
      token: { scopes: ["notifications:send", "interactions:create", "interactions:read"] },
    });
  };
  const env = {
    HOME: home,
    HARK_CONFIG: join(home, "missing.json"),
    HARK_TOKEN: "hark_environment_fixture",
    HARK_API_URL: "https://environment.example.test",
  };
  try {
    const doctor = await execute(["permissions", "doctor"], env);
    assert.equal(doctor.body.authenticated, false);
    assert.equal(requests, 0);
    await assert.rejects(execute(["permissions", "setup", "claude"], env), /not authenticated/);
    await assert.rejects(stat(join(home, ".claude", "settings.json")), { code: "ENOENT" });
  } finally {
    globalThis.fetch = originalFetch;
    await rm(home, { recursive: true, force: true });
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

test("registers, lists, and removes web apps, and opens one from notify --app", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/api/agent/apps") && init?.method === "POST") {
      return Response.json(
        {
          app: { id: "app_abcdefgh", name: "Sharkboard", url: "https://b.example/board" },
          created: true,
        },
        { status: 201 },
      );
    }
    if (String(url).endsWith("/api/agent/apps")) return Response.json({ apps: [] });
    if (String(url).endsWith("/api/agent/apps/app_abcdefgh")) return Response.json({ ok: true });
    if (String(url).endsWith("/api/agent/notifications")) {
      return Response.json({ notification: { id: "anot_1" }, accepted: 1 }, { status: 201 });
    }
    throw new Error(`unexpected ${url}`);
  };
  const env = { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" };
  try {
    const created = await execute(
      ["apps", "create", "--name", "Sharkboard", "--url", "https://b.example/board"],
      env,
    );
    assert.equal(created.exitCode, 0);
    assert.equal(created.body.app.id, "app_abcdefgh");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      name: "Sharkboard",
      url: "https://b.example/board",
    });

    const listed = await execute(["apps", "list"], env);
    assert.deepEqual(listed.body, { apps: [] });

    const removed = await execute(["apps", "remove", "app_abcdefgh"], env);
    assert.equal(removed.exitCode, 0);
    assert.equal(requests[2].init.method, "DELETE");

    const notified = await execute(
      [
        "notify",
        "Board updated",
        "--app",
        "app_abcdefgh",
        "--url",
        "https://b.example/board/ask/1",
      ],
      env,
    );
    assert.equal(notified.exitCode, 0);
    assert.deepEqual(JSON.parse(requests[3].init.body), {
      body: "Board updated",
      url: "https://b.example/board/ask/1",
      appId: "app_abcdefgh",
    });

    await assert.rejects(
      execute(["apps", "create", "--name", "x"], env),
      /requires --name and --url/,
    );
    await assert.rejects(
      execute(["notify", "ask", "Deploy?", "--approval", "--app", "app_abcdefgh"], env),
      /--app applies to notify/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explains missing app scopes on 403", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: "Insufficient scope", required: ["apps:read"] }, { status: 403 });
  try {
    await assert.rejects(
      execute(["apps", "list"], { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" }),
      /sharkctl auth login to grant app scopes/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const AGENT_ENV = { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" };

/** Replaces fetch for one test, recording each request and answering from `respond`. */
async function withMockServer(respond, callback) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const request = {
      path: String(url).replace("https://example.test", ""),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    return respond(request);
  };
  try {
    await callback(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("account commands call the matching agent routes", async () => {
  const cases = [
    [["services", "get", "svc_1"], "GET", "/api/agent/services/svc_1"],
    [["services", "rotate", "svc_1"], "POST", "/api/agent/services/svc_1/rotate"],
    [["services", "remove", "svc_1"], "DELETE", "/api/agent/services/svc_1"],
    [["devices", "remove", "dev_1"], "DELETE", "/api/agent/devices/dev_1"],
    [["inbox", "projects"], "GET", "/api/agent/inbox/projects"],
    [
      ["inbox", "list", "--project", "unfiled", "--unread", "--limit", "5", "--cursor", "abc"],
      "GET",
      "/api/agent/inbox/notifications?project=unfiled&limit=5&unread=1&cursor=abc",
    ],
    [["inbox", "get", "event:evt_1"], "GET", "/api/agent/inbox/notifications/event%3Aevt_1"],
    [
      ["inbox", "unread", "event:evt_1"],
      "POST",
      "/api/agent/inbox/notifications/event%3Aevt_1/unread",
    ],
    [["interaction", "list"], "GET", "/api/agent/interactions"],
    [
      ["activity", "feed", "--filter", "response", "--page", "2"],
      "GET",
      "/api/agent/activity-feed?filter=response&page=2",
    ],
    [["billing"], "GET", "/api/agent/billing"],
    [["tokens", "list"], "GET", "/api/agent/tokens"],
    [["tokens", "revoke", "tok_1"], "DELETE", "/api/agent/tokens/tok_1"],
    [["notify", "withdraw", "anot_1"], "POST", "/api/agent/notifications/anot_1/withdraw"],
  ];
  for (const [argv, method, path] of cases) {
    await withMockServer(
      () => Response.json({ ok: true }),
      async (requests) => {
        const result = await execute(argv, AGENT_ENV);
        assert.equal(result.exitCode, 0, argv.join(" "));
        assert.deepEqual(result.body, { ok: true });
        assert.deepEqual(
          requests.map(({ method: m, path: p }) => `${m} ${p}`),
          [`${method} ${path}`],
        );
      },
    );
  }
});

test("services update sends only the provided fields", async () => {
  await withMockServer(
    () => Response.json({ service: { id: "svc_1", title: "Bot" } }),
    async (requests) => {
      const result = await execute(
        ["services", "update", "svc_1", "--title", "Bot", "--url", "https://example.com/x"],
        AGENT_ENV,
      );
      assert.equal(result.exitCode, 0);
      assert.deepEqual(requests, [
        {
          path: "/api/agent/services/svc_1",
          method: "PATCH",
          body: { title: "Bot", url: "https://example.com/x" },
        },
      ]);
    },
  );
  await assert.rejects(execute(["services", "update", "svc_1"], AGENT_ENV), /requires --title/);
  await assert.rejects(execute(["services", "rotate"], AGENT_ENV), /requires an ID/);
});

test("inbox read-all submits the read-through token from a fresh list", async () => {
  await withMockServer(
    ({ path }) =>
      path.startsWith("/api/agent/inbox/notifications?")
        ? Response.json({ items: [], nextCursor: null, readThroughToken: "rt-token" })
        : Response.json({ ok: true, updated: 3 }),
    async (requests) => {
      const result = await execute(["inbox", "read-all", "--project", "prj_1"], AGENT_ENV);
      assert.deepEqual(result.body, { ok: true, updated: 3 });
      assert.deepEqual(requests, [
        {
          path: "/api/agent/inbox/notifications?project=prj_1&limit=1",
          method: "GET",
          body: undefined,
        },
        {
          path: "/api/agent/inbox/notifications/read-all",
          method: "POST",
          body: { readThrough: "rt-token", project: "prj_1" },
        },
      ]);
    },
  );
});

test("notify withdraw is a subcommand unless it follows --", async () => {
  await assert.rejects(
    execute(["notify", "withdraw", "the", "deploy"], AGENT_ENV),
    /exactly one notification ID/,
  );
  await withMockServer(
    () => Response.json({ notification: { id: "anot_2" }, accepted: 1 }, { status: 201 }),
    async (requests) => {
      const result = await execute(["notify", "--", "withdraw"], AGENT_ENV);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(requests, [
        { path: "/api/agent/notifications", method: "POST", body: { body: "withdraw" } },
      ]);
    },
  );
});

test("apps update sends metadata only and prints a readable line", async () => {
  const app = {
    id: "app_1",
    name: "Ops",
    url: "https://new.example.com/",
    consentedAt: null,
  };
  await withMockServer(
    () => Response.json({ app }),
    async (requests) => {
      const result = await execute(
        [
          "apps",
          "update",
          "app_1",
          "--url",
          "https://new.example.com/",
          "--no-icon",
          "--no-project",
        ],
        AGENT_ENV,
      );
      assert.equal(
        result.output,
        "app_1  Ops  https://new.example.com/ (approve sign-in on your phone)",
      );
      assert.deepEqual(requests[0], {
        path: "/api/agent/apps/app_1",
        method: "PATCH",
        body: { url: "https://new.example.com/", iconUrl: null, project: null },
      });
      const revoked = await execute(["apps", "revoke", "app_1", "--json"], AGENT_ENV);
      assert.deepEqual(revoked.body, { app });
      assert.equal(revoked.output, undefined);
      assert.equal(requests[1].path, "/api/agent/apps/app_1/revoke");
    },
  );
  await assert.rejects(
    execute(
      ["apps", "update", "app_1", "--icon", "https://example.com/i.png", "--no-icon"],
      AGENT_ENV,
    ),
    /cannot be used together/,
  );
  await assert.rejects(execute(["apps", "update", "app_1"], AGENT_ENV), /requires --name/);
});

test("a missing scope names the scopes to grant and exits 3", async () => {
  await withMockServer(
    () =>
      Response.json({ error: "Insufficient scope", required: ["tokens:manage"] }, { status: 403 }),
    async () => {
      await assert.rejects(execute(["tokens", "list"], AGENT_ENV), /grant tokens:manage/);
      const originalError = console.error;
      console.error = () => {};
      try {
        assert.equal(await run(["tokens", "list"], AGENT_ENV), 3);
      } finally {
        console.error = originalError;
      }
    },
  );
});

test("default login scopes include the account scopes but not tokens:manage", async () => {
  await withMockServer(
    () => Response.json({ error: "stop here" }, { status: 400 }),
    async (requests) => {
      await assert.rejects(
        execute(["auth", "login", "--no-open"], { HARK_API_URL: "https://example.test" }),
        /stop here/,
      );
      const { scopes } = requests[0].body;
      for (const scope of ["devices:write", "inbox:read", "inbox:write", "billing:read"]) {
        assert.ok(scopes.includes(scope), scope);
      }
      assert.equal(scopes.includes("tokens:manage"), false);
    },
  );
});
