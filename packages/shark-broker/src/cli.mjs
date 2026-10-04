import { fileURLToPath } from "node:url";
import { Broker } from "./broker.mjs";
import { runDaemon } from "./daemon.mjs";
import { BrokerError, requireValue, safeError } from "./errors.mjs";
import { defaultPaths, loadBrokerConfig } from "./files.mjs";
import { canonical } from "./json.mjs";
import { ServiceManager } from "./service.mjs";
import { loadSession } from "./session.mjs";
import { Store } from "./store.mjs";

const entry = fileURLToPath(new URL("../bin/sharkd.mjs", import.meta.url));
const HELP = `sharkd — private SHark reply broker\n\nCommands:\n  turn complete --summary TEXT [--question TEXT --session-ref-file PATH] --idempotency-key KEY\n  request register --session-ref-file PATH --kind form|permission --request-id ID --prompt TEXT --idempotency-key KEY\n  run [--once]\n  status\n  queue list|show|retry|discard [ID]\n  service install|status|restart|uninstall\n\nOptions: --config ABSOLUTE_PATH --database ABSOLUTE_PATH --title TEXT --expires-in DURATION\nUse turn complete --stdin for a bounded JSON object; command flags override its content.\nCompletion reply harnesses: opencode-v2, codex (existing native Unix-socket owner).\nCodex queue retry reconciles attempted sends without resubmitting them.\nOnly queue show prints stored content. Native session references and credentials stay on the host.\n`;

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  const values = new Set([
    "summary",
    "question",
    "title",
    "idempotency-key",
    "session-ref-file",
    "expires-in",
    "config",
    "database",
    "kind",
    "request-id",
    "prompt",
  ]);
  const booleans = new Set(["help", "once", "stdin"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    requireValue(!Object.hasOwn(flags, key) && (values.has(key) || booleans.has(key)), "option");
    if (booleans.has(key)) flags[key] = true;
    else {
      requireValue(i + 1 < argv.length, "option_value");
      flags[key] = argv[++i];
    }
  }
  return { positionals, flags };
}
function duration(value) {
  if (value === undefined) return undefined;
  const match = value.match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);
  requireValue(match, "duration");
  return Math.round(Number(match[1]) * { s: 1, m: 60, h: 3600, d: 86_400 }[match[2] ?? "s"]);
}
async function inputJSON(stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    requireValue(size <= 65_536, "stdin_size");
    chunks.push(bytes);
  }
  let value;
  try {
    value = canonical(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new BrokerError(2, "invalid_stdin_json");
  }
  requireValue(value && typeof value === "object" && !Array.isArray(value), "stdin_object");
  requireValue(
    Object.keys(value).every((key) =>
      ["summary", "question", "title", "idempotencyKey", "session", "expiresInSeconds"].includes(
        key,
      ),
    ),
    "stdin_fields",
  );
  return value;
}

export async function main(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    stdin = process.stdin,
    serviceFactory = (options) => new ServiceManager(options),
    brokerOptions = {},
    signal,
  } = {},
) {
  let store;
  try {
    const { positionals, flags } = parseArgs(argv);
    if (flags.help || positionals.length === 0) {
      stdout.write(HELP);
      return 0;
    }
    const [command, action, id] = positionals;
    const allowed = {
      "turn complete": [
        "summary",
        "question",
        "title",
        "idempotency-key",
        "session-ref-file",
        "expires-in",
        "stdin",
      ],
      "request register": [
        "session-ref-file",
        "kind",
        "request-id",
        "prompt",
        "title",
        "idempotency-key",
        "expires-in",
      ],
      run: ["once"],
      status: [],
      "queue list": [],
      "queue show": [],
      "queue retry": [],
      "queue discard": [],
      "service install": [],
      "service status": [],
      "service restart": [],
      "service uninstall": [],
    };
    const route = ["run", "status"].includes(command) ? command : `${command} ${action}`;
    requireValue(Object.hasOwn(allowed, route), "command");
    const withID = ["queue show", "queue retry", "queue discard"].includes(route);
    requireValue(
      positionals.length === (withID ? 3 : ["run", "status"].includes(route) ? 1 : 2),
      "arguments",
    );
    requireValue(
      Object.keys(flags).every((key) => ["config", "database", ...allowed[route]].includes(key)),
      "command_option",
    );
    const defaults = defaultPaths();
    const configPath = flags.config ?? defaults.config;
    const database = flags.database ?? defaults.database;
    const service = serviceFactory({ node: process.execPath, entry, config: configPath, database });
    if (route === "service uninstall") {
      stdout.write(`${JSON.stringify(await service.uninstall())}\n`);
      return 0;
    }
    if (["status", "service status", "queue list", "queue show"].includes(route)) {
      store = await Store.open(database);
      if (route === "queue list") stdout.write(`${JSON.stringify({ items: store.list() })}\n`);
      else if (route === "queue show") {
        const row = store.get(id);
        if (!row) throw new BrokerError(4, "queue_item_missing");
        stdout.write(
          `${JSON.stringify({ id: row.id, state: row.state, kind: row.kind, data: row.data })}\n`,
        );
      } else {
        const health = await service.health(store);
        stdout.write(`${JSON.stringify(health)}\n`);
        return health.healthy ? 0 : 6;
      }
      return 0;
    }
    const config = await loadBrokerConfig(configPath);
    store = await Store.open(database);
    const broker = new Broker({ ...brokerOptions, store, config });
    let result;
    if (route === "turn complete") {
      const input = flags.stdin ? await inputJSON(stdin) : {};
      for (const key of ["summary", "question", "title"])
        if (flags[key] !== undefined) input[key] = flags[key];
      if (flags["idempotency-key"] !== undefined) input.idempotencyKey = flags["idempotency-key"];
      if (flags["expires-in"] !== undefined) input.expiresInSeconds = duration(flags["expires-in"]);
      if (flags["session-ref-file"]) input.session = await loadSession(flags["session-ref-file"]);
      result = await broker.register(input);
    } else if (route === "request register") {
      result = await broker.registerActive({
        session: await loadSession(flags["session-ref-file"]),
        kind: flags.kind,
        requestID: flags["request-id"],
        prompt: flags.prompt,
        ...(flags.title ? { title: flags.title } : {}),
        idempotencyKey: flags["idempotency-key"],
        ...(flags["expires-in"] ? { expiresInSeconds: duration(flags["expires-in"]) } : {}),
      });
    } else if (command === "queue") result = await broker[action](id);
    else if (command === "service") {
      await broker.identity();
      result = await service[action](store);
    } else if (route === "run") {
      const controller = new AbortController();
      const stop = () => controller.abort();
      if (!signal) {
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      }
      try {
        result = await runDaemon({
          broker,
          store,
          entryPath: entry,
          signal: signal ?? controller.signal,
          once: flags.once,
        });
      } finally {
        if (!signal) {
          process.removeListener("SIGINT", stop);
          process.removeListener("SIGTERM", stop);
        }
      }
    }
    stdout.write(`${JSON.stringify(result)}\n`);
    return result.code ?? 0;
  } catch (error) {
    const safe = safeError(error);
    stderr.write(`${JSON.stringify(safe)}\n`);
    return safe.code;
  } finally {
    store?.close();
  }
}
