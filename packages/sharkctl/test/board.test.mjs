import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BOARD_HELP,
  boardExitCode,
  findBoardSecret,
  parseLinks,
  parseOptions,
} from "../src/board.mjs";
import { execute, parseArgs } from "../src/cli.mjs";

const env = { HARK_TOKEN: "hark_test", HARK_API_URL: "https://example.test" };

function mockFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("parses repeatable options and links and derives option ids", () => {
  const parsed = parseArgs([
    "board",
    "ask",
    "--key",
    "fm:x",
    "--title",
    "T",
    "--option",
    "Ship now:primary",
    "--option",
    "wait=Wait a week",
    "--option",
    "Ship now",
    "--link",
    "pr=https://github.com/x/y/pull/1",
    "--link",
    "https://linear.app/x/issue/Y-1",
    "--allow-text",
    "--no-later",
  ]);
  assert.deepEqual(parsed.options.option, ["Ship now:primary", "wait=Wait a week", "Ship now"]);
  assert.deepEqual(parseOptions(parsed.options.option), [
    { id: "ship-now", label: "Ship now", style: "primary" },
    { id: "wait", label: "Wait a week", style: "neutral" },
    { id: "ship-now-2", label: "Ship now", style: "neutral" },
  ]);
  assert.deepEqual(parseLinks(parsed.options.link), [
    { kind: "pr", url: "https://github.com/x/y/pull/1" },
    { kind: "other", url: "https://linear.app/x/issue/Y-1" },
  ]);
  assert.throws(() => parseLinks(["http://plain.example/"]), /HTTPS/);
  assert.throws(() => parseOptions(["a=One", "a=Two"]), /Duplicate option id/);
  assert.equal(parsed.options["allow-text"], true);
  assert.equal(parsed.options["no-later"], true);
});

test("screens secrets locally and maps statuses to exit codes", () => {
  assert.equal(findBoardSecret(`token hark_${"a".repeat(43)}`), "SHark API token");
  assert.equal(findBoardSecret("-----BEGIN RSA PRIVATE KEY-----"), "private key");
  assert.equal(findBoardSecret("https://github.com/shuv1337/shark/pull/82"), null);
  assert.equal(findBoardSecret("FM-CAP-BOARD-2 sb-ci-speedup"), null);
  assert.equal(boardExitCode({ status: "open" }), 0);
  assert.equal(boardExitCode({ status: "answered" }), 0);
  assert.equal(boardExitCode({ status: "expired" }), 4);
  assert.equal(boardExitCode({ status: "cancelled" }), 4);
});

test("board ask upserts, reads the callback token from a file, and waits for the answer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sharkctl-board-"));
  const tokenPath = join(directory, "token");
  await writeFile(tokenPath, `${"k".repeat(40)}\n`);
  const bodyPath = join(directory, "body.md");
  await writeFile(bodyPath, "Two options.\nPick one.\n");
  let waits = 0;
  const { calls, restore } = mockFetch((call) => {
    if (call.method === "PUT") {
      return Response.json(
        {
          ask: { id: "bask_1", key: "fm:x", status: "open", digest: "d", revision: 1 },
          created: true,
          changed: true,
          pushed: true,
        },
        { status: 201 },
      );
    }
    waits += 1;
    return Response.json({
      ask: { id: "bask_1", key: "fm:x", status: waits >= 2 ? "answered" : "open" },
      timedOut: waits < 2,
    });
  });
  try {
    const result = await execute(
      [
        "board",
        "ask",
        "--key",
        "fm:x",
        "--title",
        "Ship?",
        "--body-file",
        bodyPath,
        "--option",
        "Ship:primary",
        "--option",
        "Wait",
        "--kind",
        "approval",
        "--priority",
        "p0",
        "--task",
        "FM-1",
        "--link",
        "pr=https://github.com/x/y/pull/1",
        "--callback-url-env",
        "GROK_ROUTINE_URL",
        "--callback-token-file",
        tokenPath,
        "--wait",
        "--timeout",
        "2m",
      ],
      { ...env, GROK_ROUTINE_URL: "https://grok.example/routine" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.body.ask.status, "answered");
    assert.equal(result.body.timedOut, false);
    assert.equal(calls[0].url, "https://example.test/api/agent/board/asks");
    assert.deepEqual(calls[0].body, {
      key: "fm:x",
      title: "Ship?",
      body: "Two options.\nPick one.",
      kind: "approval",
      options: [
        { id: "ship", label: "Ship", style: "primary" },
        { id: "wait", label: "Wait", style: "neutral" },
      ],
      priority: "p0",
      taskId: "FM-1",
      links: [{ kind: "pr", url: "https://github.com/x/y/pull/1" }],
      callback: { url: "https://grok.example/routine", token: "k".repeat(40) },
    });
    assert.match(calls[1].url, /\/api\/agent\/board\/asks\/fm%3Ax\/wait\?timeout=25$/);
  } finally {
    restore();
  }
});

test("board ask refuses a secret before any request and validates enums", async () => {
  const { calls, restore } = mockFetch(() => Response.json({}));
  try {
    await assert.rejects(
      execute(
        ["board", "ask", "--key", "k", "--title", `hark_${"x".repeat(43)}`, "--option", "Ok"],
        env,
      ),
      /looks like a SHark API token/,
    );
    await assert.rejects(
      execute(["board", "ask", "--key", "k", "--title", "T", "--priority", "p9"], env),
      /--priority/,
    );
    await assert.rejects(
      execute(["board", "ask", "--key", "k", "--title", "T", "--callback-url-env", "X"], env),
      /go together/,
    );
    await assert.rejects(
      execute(["board", "ask", "--title", "T"], env),
      /requires --key and --title/,
    );
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("board wait sends a tenth-of-a-second wait timeout and never asks past its deadline", async () => {
  const { calls, restore } = mockFetch((call) => {
    if (call.url.includes("/wait")) return Response.json({ ask: { status: "open" } });
    return Response.json({ ask: { status: "open" } });
  });
  // Deadline at 0 ms; the first request is built at 1 ms and the second at 20 600 ms, after
  // which the clock reaches the deadline.
  const ticks = [0, 1, 20_600, 20_600, 30_000];
  try {
    const waited = await execute(["board", "wait", "--key", "fm:x", "--timeout", "30s"], env, {
      now: () => (ticks.length > 1 ? ticks.shift() : ticks[0]),
    });
    assert.equal(waited.exitCode, 4);
    assert.equal(waited.body.timedOut, true);
    const timeouts = calls.map((call) => call.url.match(/\/wait\?timeout=([\d.]+)$/)?.[1]);
    assert.deepEqual(timeouts, ["25", "9.4"]);
  } finally {
    restore();
  }
});

test("board wait, get, answers, ack, cancel map to their routes and exit codes", async () => {
  const { calls, restore } = mockFetch((call) => {
    if (call.url.includes("/wait")) return Response.json({ ask: { status: "cancelled" } });
    if (call.url.endsWith("/answers?since=abc&limit=10")) {
      return Response.json({ events: [{ eventId: "bask_1:r1:answered" }], cursor: "def" });
    }
    if (call.url.endsWith("/ack")) return Response.json({ ask: { status: "answered" } });
    if (call.url.endsWith("/cancel")) return Response.json({ ask: { status: "cancelled" } });
    return Response.json({ ask: { status: "expired" } });
  });
  try {
    const waited = await execute(["board", "wait", "--key", "fm:x", "--timeout", "30s"], env);
    assert.equal(waited.exitCode, 4);
    const got = await execute(["board", "get", "--key", "fm:x"], env);
    assert.equal(got.exitCode, 4);
    const answers = await execute(["board", "answers", "--since", "abc", "--limit", "10"], env);
    assert.equal(answers.exitCode, 0);
    assert.equal(answers.body.cursor, "def");
    const acked = await execute(["board", "ack", "--key", "fm:x"], env);
    assert.equal(acked.exitCode, 0);
    const cancelled = await execute(["board", "cancel", "--key", "fm:x", "--reason", "Moot"], env);
    assert.equal(cancelled.exitCode, 0);
    assert.deepEqual(calls.at(-1).body, { reason: "Moot" });
    assert.equal(calls.at(-1).method, "POST");
  } finally {
    restore();
  }
});

test("board work, done, and note send the documented payloads", async () => {
  const { calls, restore } = mockFetch(() => Response.json({ ok: true }, { status: 200 }));
  try {
    await execute(
      [
        "board",
        "work",
        "--key",
        "bro:sb-1",
        "--title",
        "CI",
        "--state",
        "in_flight",
        "--status",
        "Testing",
        "--progress",
        "0.4",
        "--host",
        "shuvdev",
        "--waiting-ask",
        "bro:q",
        "--heartbeat-ttl",
        "10m",
      ],
      env,
    );
    assert.equal(calls[0].method, "PUT");
    assert.deepEqual(calls[0].body, {
      key: "bro:sb-1",
      title: "CI",
      state: "in_flight",
      statusLabel: "Testing",
      progress: 0.4,
      host: "shuvdev",
      waitingAskKey: "bro:q",
      heartbeatTtlSeconds: 600,
    });
    await execute(
      [
        "board",
        "done",
        "--key",
        "bro:sb-1",
        "--verb",
        "merged",
        "--link",
        "pr=https://github.com/x/y/pull/2",
      ],
      env,
    );
    assert.equal(calls[1].url, "https://example.test/api/agent/board/work/bro%3Asb-1/done");
    assert.deepEqual(calls[1].body, {
      verb: "merged",
      links: [{ kind: "pr", url: "https://github.com/x/y/pull/2" }],
    });
    await execute(
      ["board", "note", "--key", "fm:disk", "Disk at 80%", "on shuvdev", "--expires-in", "1d"],
      env,
    );
    assert.deepEqual(calls[2].body, {
      key: "fm:disk",
      text: "Disk at 80% on shuvdev",
      expiresInSeconds: 86_400,
    });
    await execute(["board", "note", "--key", "fm:disk", "--clear"], env);
    assert.equal(calls[3].method, "DELETE");
    assert.equal(calls[3].url, "https://example.test/api/agent/board/notes/fm%3Adisk");
    await assert.rejects(
      execute(["board", "work", "--key", "k", "--title", "T", "--state", "flying"], env),
      /--state/,
    );
    await assert.rejects(execute(["board", "done", "--key", "k", "--verb", "won"], env), /--verb/);
    await assert.rejects(execute(["board", "frobnicate"], env), /board verbs/);
  } finally {
    restore();
  }
});

test("board work forwards a {progress:null} clear from stdin", async () => {
  const { calls, restore } = mockFetch(() => Response.json({ ok: true }, { status: 200 }));
  try {
    await execute(
      ["board", "work", "--key", "k", "--title", "T", "--state", "in_flight", "--stdin"],
      env,
      { stdin: [JSON.stringify({ progress: null, links: [] })] },
    );
    assert.deepEqual(calls[0].body, {
      progress: null,
      links: [],
      key: "k",
      title: "T",
      state: "in_flight",
    });
    await assert.rejects(
      execute(
        ["board", "work", "--key", "k", "--title", "T", "--state", "in_flight", "--stdin"],
        env,
        { stdin: [JSON.stringify({ progress: 2 })] },
      ),
      /--progress must be a number from 0 to 1/,
    );
  } finally {
    restore();
  }
});

test("board work, done, and note send --agent and screen it before sending", async () => {
  const { calls, restore } = mockFetch(() => Response.json({ ok: true }, { status: 200 }));
  try {
    const agent = ["--agent", "Synthetic Harness"];
    await execute(
      ["board", "work", "--key", "k", "--title", "T", "--state", "queued", ...agent],
      env,
    );
    await execute(["board", "done", "--key", "k", ...agent], env);
    await execute(["board", "note", "--key", "n", "Heads up", ...agent], env);
    assert.deepEqual(
      calls.map((call) => call.body.agentDisplay),
      ["Synthetic Harness", "Synthetic Harness", "Synthetic Harness"],
    );
    const secret = ["--agent", `hark_${"s".repeat(43)}`];
    for (const argv of [
      ["board", "work", "--key", "k", "--title", "T", "--state", "queued", ...secret],
      ["board", "done", "--key", "k", ...secret],
      ["board", "note", "--key", "n", "Heads up", ...secret],
    ]) {
      await assert.rejects(execute(argv, env), /Refusing to send board content/);
    }
    assert.equal(calls.length, 3);
  } finally {
    restore();
  }
  for (const verb of ["ask", "work", "done", "note"]) {
    const usage = BOARD_HELP.split("\n  sharkctl board ")
      .map((block, index) => (index === 0 ? block.replace(/^\s*sharkctl board /, "") : block))
      .filter((block) => block.startsWith(`${verb} `) && !block.includes("--clear"));
    assert.ok(usage.length > 0 && usage.every((block) => block.includes("--agent <name>")), verb);
  }
});

test("a board 403 names the scope the route requires", async () => {
  const { restore } = mockFetch(() =>
    Response.json({ error: "Insufficient scope", required: ["board:write"] }, { status: 403 }),
  );
  try {
    await assert.rejects(
      execute(["board", "work", "--key", "k", "--title", "T", "--state", "queued"], env),
      (error) => error.status === 403 && /board:write/.test(error.message),
    );
  } finally {
    restore();
  }
});
