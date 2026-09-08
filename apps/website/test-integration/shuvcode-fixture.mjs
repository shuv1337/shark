import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

export async function shuvcodeFixture(binary) {
  if (process.platform !== "darwin")
    throw new Error("This acceptance probe requires the macOS loopback sandbox");
  if (!path.isAbsolute(binary))
    throw new Error("SHUV_ARBITRATION_BINARY must be an absolute compiled-binary path");
  const root = await mkdtemp(path.join(tmpdir(), "shark-shuvcode-arbitration-"));
  const password = randomBytes(32).toString("base64url");
  let modelCalls = 0;
  let holdNext = false;
  const held = [];
  const model = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain; never retain prompts. */
    }
    modelCalls++;
    const ordinal = modelCalls;
    const complete = () => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ id: `synthetic-${ordinal}`, object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta: { role: "assistant", content: `Synthetic reply ${ordinal}.` }, finish_reason: null }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ id: `synthetic-${ordinal}`, object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    };
    if (holdNext) {
      holdNext = false;
      held.push(complete);
    } else complete();
  });
  await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
  await mkdir(path.join(root, "config"));
  await mkdir(path.join(root, ".git"));
  await writeFile(
    path.join(root, "config/opencode.json"),
    JSON.stringify({
      autoupdate: false,
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "shell", resource: "*", effect: "ask" },
      ],
      providers: {
        "arbitration-fixture": {
          package: "aisdk:@ai-sdk/openai-compatible",
          env: ["SHUV_FIXTURE_KEY"],
          settings: {
            baseURL: `http://127.0.0.1:${model.address().port}/v1`,
            name: "arbitration-fixture",
          },
          models: {
            synthetic: {
              name: "Synthetic",
              limit: { context: 200_000, output: 100 },
              capabilities: { tools: false, input: ["text"], output: ["text"] },
            },
          },
        },
      },
    }),
    { mode: 0o600 },
  );
  let child;
  let exited;
  let base;
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  };
  async function start() {
    child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))',
        binary,
        "serve",
        "--stdio",
        "--hostname",
        "127.0.0.1",
        "--port",
        "0",
      ],
      {
        cwd: root,
        env: {
          HOME: root,
          PATH: "/opt/homebrew/bin:/usr/bin:/bin",
          OPENCODE_TEST_HOME: root,
          OPENCODE_CONFIG_DIR: path.join(root, "config"),
          OPENCODE_DB: path.join(root, "probe.db"),
          OPENCODE_PASSWORD: password,
          OPENCODE_PERSIST_EVENTS: "true",
          SHUV_FIXTURE_KEY: "synthetic-noncredential",
          OPENCODE_CONFIG_PROJECT_DISABLE: "true",
          OPENCODE_DISABLE_FFF: "true",
          OPENCODE_DISABLE_FILEWATCHER: "true",
          OPENCODE_DISABLE_MODELS_FETCH: "true",
          OPENCODE_DISABLE_AUTOUPDATE: "true",
          XDG_CONFIG_HOME: path.join(root, "xdg-config"),
          XDG_DATA_HOME: path.join(root, "data"),
          XDG_CACHE_HOME: path.join(root, "cache"),
          XDG_STATE_HOME: path.join(root, "state"),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    exited = new Promise((resolve) => child.once("close", resolve));
    child.stderr.resume(); // No credentials, request contents, or native logs retained.
    try {
      base = await new Promise((resolve, reject) => {
        let output = "";
        let received = false;
        const timer = setTimeout(
          () => reject(new Error("Isolated native server startup timeout")),
          20_000,
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Isolated native server exited"));
        });
        child.stdout.on("data", (chunk) => {
          if (received) return;
          output += chunk.toString();
          if (output.length > 65_536) {
            clearTimeout(timer);
            reject(new Error("Oversized fixture startup output"));
            return;
          }
          if (!output.includes("\n")) return;
          try {
            const url = new URL(JSON.parse(output.split("\n")[0]).url);
            if (url.hostname !== "127.0.0.1") throw new Error("Non-loopback fixture address");
            clearTimeout(timer);
            received = true;
            resolve(url.origin);
          } catch {
            clearTimeout(timer);
            reject(new Error("Invalid fixture startup address"));
          }
        });
      });
    } catch (error) {
      await stop();
      throw error;
    }
  }
  const native = async (method, route, payload) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
        "content-type": "application/json",
        "x-opencode-directory": encodeURIComponent(root),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  try {
    await start();
  } catch (error) {
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    native,
    root,
    sessionReference: async (sessionId) => {
      const authFile = path.join(root, "native-auth.json");
      await writeFile(authFile, JSON.stringify({ password }), { mode: 0o600 });
      return {
        version: 1,
        harness: "opencode-v2",
        sessionId,
        cwd: root,
        adapterData: { serverUrl: base, authFile },
      };
    },
    modelCalls: () => modelCalls,
    holdNextModel: () => {
      holdNext = true;
    },
    releaseModel: () => {
      for (const complete of held.splice(0)) complete();
    },
    restart: async () => {
      await stop();
      await start();
    },
    close: async () => {
      await stop();
      model.closeAllConnections();
      await new Promise((resolve) => model.close(resolve));
      await rm(root, { recursive: true, force: true });
    },
  };
}
