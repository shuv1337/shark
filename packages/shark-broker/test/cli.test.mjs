import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { main } from "../src/cli.mjs";
import { completion, fixture } from "./fixture.mjs";

async function cli(t) {
  const f = await fixture(t);
  const config = path.join(f.root, "config.json");
  await writeFile(config, JSON.stringify(f.config), { mode: 0o600 });
  return {
    ...f,
    configPath: config,
    invoke: async (args, body = "") => {
      let stdout = "";
      let stderr = "";
      const code = await main([...args, "--config", config, "--database", f.file], {
        stdout: {
          write: (chunk) => {
            stdout += chunk;
          },
        },
        stderr: {
          write: (chunk) => {
            stderr += chunk;
          },
        },
        stdin: Readable.from([body]),
        brokerOptions: { api: f.api, adapter: f.adapter },
      });
      return { code, stdout, stderr };
    },
  };
}

test("CLI structured completion returns interaction identity; list omits content and show is explicit", async (t) => {
  const f = await cli(t);
  const result = await f.invoke(["turn", "complete", "--stdin"], JSON.stringify(completion()));
  assert.equal(result.code, 0);
  const body = JSON.parse(result.stdout);
  assert.ok(body.interactionId);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout.includes("What next"), false);
  const listed = await f.invoke(["queue", "list"]);
  assert.equal(listed.code, 0);
  assert.equal(listed.stdout.includes("What next"), false);
  const shown = await f.invoke(["queue", "show", body.id]);
  assert.equal(shown.code, 0);
  assert.ok(shown.stdout.includes("What next"));
  assert.equal(shown.stdout.includes(f.config.token), false);
});

test("CLI validates bounded stdin, unsupported adapters, and missing fields without exposing inputs", async (t) => {
  const f = await cli(t);
  for (const body of [
    "{",
    JSON.stringify({ ...completion(), session: { ...completion().session, harness: "codex" } }),
    JSON.stringify({ unknown: "private" }),
    "x".repeat(65537),
  ]) {
    const result = await f.invoke(["turn", "complete", "--stdin"], body);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes("private"), false);
  }
  assert.equal(f.store.list().length, 0);
});

test("CLI protected configuration failure maps to redacted exit 3", async (t) => {
  const f = await cli(t);
  await chmod(f.configPath, 0o644);
  const result = await f.invoke([
    "turn",
    "complete",
    "--summary",
    "Private text",
    "--idempotency-key",
    "key",
  ]);
  assert.equal(result.code, 3);
  assert.equal(result.stderr.includes(f.config.token), false);
  assert.equal(result.stderr.includes("Private text"), false);
});

test("CLI plain completion zero acceptance exits 7 and run once exits cleanly", async (t) => {
  const f = await cli(t);
  f.state.accepted = 0;
  assert.equal(
    (await f.invoke(["turn", "complete", "--summary", "Finished", "--idempotency-key", "plain"]))
      .code,
    7,
  );
  assert.equal((await f.invoke(["run", "--once"])).code, 0);
});
