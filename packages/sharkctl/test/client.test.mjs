import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cancelInteraction,
  createInteraction,
  createNotification,
  getAuthStatus,
  getInteraction,
  listDevices,
  loadFileConfig,
  RequestError,
  request,
} from "sharkctl/client";
import { RequestError as CliRequestError } from "../src/cli.mjs";

const config = { token: `hark_${"s".repeat(43)}`, apiUrl: "https://example.test" };

async function protectedFile(t, value = config) {
  const directory = await mkdtemp(join(tmpdir(), "shark-client-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return path;
}

test("protected config keeps file credentials despite ambient token and origin", async (t) => {
  const path = await protectedFile(t);
  const result = await loadFileConfig(path, {
    HARK_TOKEN: "hark_synthetic_ambient",
    HARK_API_URL: "https://wrong.example.test",
    HARK_CONFIG: path,
  });
  assert.deepEqual(result, { ...config, tokenId: undefined, source: "file", path });
  await assert.rejects(loadFileConfig(path, { HARK_CONFIG: `${path}.other` }), RequestError);
});

test("protected config rejects missing, relative, insecure, symlink and malformed files", async (t) => {
  const path = await protectedFile(t);
  await assert.rejects(loadFileConfig(`${path}.missing`, {}), RequestError);
  await assert.rejects(loadFileConfig("config.json", {}), RequestError);
  await chmod(path, 0o640);
  await assert.rejects(loadFileConfig(path, {}), RequestError);
  await chmod(path, 0o400);
  await assert.rejects(loadFileConfig(path, {}), RequestError);
  await chmod(path, 0o600);
  const link = `${path}.link`;
  await symlink(path, link);
  await assert.rejects(loadFileConfig(link, {}), RequestError);
  await writeFile(path, "{synthetic invalid JSON");
  await assert.rejects(loadFileConfig(path, {}), RequestError);
  await writeFile(path, " ".repeat(65_537));
  await assert.rejects(loadFileConfig(path, {}), RequestError);
});

test("protected config validates tokens and rejects credential-bearing or non-origin URLs", async (t) => {
  const path = await protectedFile(t);
  const invalid = [
    null,
    {},
    { ...config, token: "hark_" },
    { ...config, token: "not-a-shark-token" },
    { ...config, token: "hark_bad\nheader" },
    { ...config, token: `hark_${"s".repeat(42)}\0` },
    { ...config, token: `hark_${"s".repeat(42)}😀` },
    { ...config, token: `hark_${"s".repeat(44)}` },
    { ...config, apiUrl: undefined },
    { ...config, apiUrl: "not a URL" },
    { ...config, apiUrl: "file:///tmp/test" },
    { ...config, apiUrl: "http://example.test" },
    { ...config, apiUrl: "https://example.test/private" },
    { ...config, apiUrl: "https://example.test?token=synthetic" },
    { ...config, apiUrl: "https://example.test/#synthetic" },
    { ...config, apiUrl: "https://synthetic:secret@example.test" },
  ];
  for (const value of invalid) {
    await writeFile(path, JSON.stringify(value));
    await assert.rejects(loadFileConfig(path, {}), (error) => {
      assert.ok(error instanceof RequestError);
      assert.equal(error.status, 401);
      assert.doesNotMatch(error.message, /synthetic|secret|hark_bad/);
      return true;
    });
  }
  for (const apiUrl of ["http://localhost:1234", "http://127.0.0.1:1234", "http://[::1]:1234"]) {
    await writeFile(path, JSON.stringify({ ...config, apiUrl }));
    assert.equal((await loadFileConfig(path, {})).apiUrl, apiUrl);
  }
});

test("client helpers preserve wire payload, idempotency and cancellation signal", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return Response.json({ accepted: 1 });
  });
  const signal = new AbortController().signal;
  const input = { prompt: "Synthetic question?", kind: "text", deviceIds: ["dev_synthetic"] };
  assert.deepEqual(await createInteraction(config, input, { idempotencyKey: "event-1", signal }), {
    accepted: 1,
  });
  await createNotification(config, { body: "Synthetic completion" }, { idempotencyKey: "event-2" });
  await getAuthStatus(config);
  await listDevices(config);
  await getInteraction(config, "synthetic/id?query#fragment");
  await cancelInteraction(config, "synthetic/id", { signal });
  assert.equal(calls.length, 6);
  assert.equal(calls[0].url, "https://example.test/api/agent/interactions");
  assert.equal(calls[0].init.body, JSON.stringify(input));
  assert.equal(calls[0].init.headers.authorization, `Bearer ${config.token}`);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "event-1");
  assert.equal(calls[0].init.signal, signal);
  assert.equal(calls[1].url, "https://example.test/api/agent/notifications");
  assert.equal(calls[1].init.headers["Idempotency-Key"], "event-2");
  assert.equal(calls[2].url, "https://example.test/api/agent/auth/status");
  assert.equal(calls[3].url, "https://example.test/api/agent/devices");
  assert.equal(
    calls[4].url,
    "https://example.test/api/agent/interactions/synthetic%2Fid%3Fquery%23fragment",
  );
  assert.equal(calls[5].url, "https://example.test/api/agent/interactions/synthetic%2Fid/cancel");
  assert.equal(calls[5].init.method, "POST");
  assert.equal(calls[5].init.signal, signal);
});

test("client preserves errors and never retries failed mutations", async (t) => {
  assert.equal(RequestError, CliRequestError);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return Response.json({ error: "Invalid device selection" }, { status: 400 });
  });
  await assert.rejects(createInteraction(config, { prompt: "Synthetic?" }), (error) => {
    assert.ok(error instanceof RequestError);
    assert.equal(error.status, 400);
    assert.equal(error.body.error, "Invalid device selection");
    return true;
  });
  assert.equal(calls, 1);
});

test("network errors retain the CLI's status-zero contract", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("synthetic disconnected transport");
  });
  await assert.rejects(request(config, "/api/agent/devices"), (error) => {
    assert.ok(error instanceof RequestError);
    assert.equal(error.status, 0);
    return true;
  });
});
