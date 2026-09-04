import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LABEL = "dev.shuv.shark-permission-bridge";
const STATUS_MESSAGE = "Waiting for SHark approval...";

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWrite(path, content, expected) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const latest = await readOptional(path);
  if ((latest === undefined ? undefined : digest(latest)) !== expected) {
    throw new Error(`Configuration changed while installing: ${path}`);
  }
  const previousMode = latest === undefined ? 0o600 : (await stat(path)).mode & 0o777;
  const temporary = `${path}.shark-${process.pid}-${Date.now()}`;
  try {
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, previousMode);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readJson(path, fallback) {
  const content = await readOptional(path);
  const value = content === undefined ? structuredClone(fallback) : JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${path}`);
  }
  return { content, hash: content === undefined ? undefined : digest(content), value };
}

function cleanEmptyHooks(config) {
  if (!config.hooks || Object.keys(config.hooks).length > 0) return;
  delete config.hooks;
}

function isClaudeHandler(handler) {
  return (
    handler?.type === "command" &&
    handler?.statusMessage === STATUS_MESSAGE &&
    Array.isArray(handler.args) &&
    handler.args.at(-3) === "permissions" &&
    handler.args.at(-2) === "hook" &&
    handler.args.at(-1) === "claude"
  );
}

function isCodexHandler(handler) {
  return (
    handler?.type === "command" &&
    typeof handler.command === "string" &&
    handler.command.includes("sharkctl") &&
    handler.command.endsWith(" permissions hook codex")
  );
}

function removeGroups(groups, predicate) {
  if (groups === undefined) return [];
  if (!Array.isArray(groups)) throw new Error("PermissionRequest hooks must be an array");
  return groups
    .map((group) => {
      if (!group || typeof group !== "object" || !Array.isArray(group.hooks)) return group;
      return { ...group, hooks: group.hooks.filter((hook) => !predicate(hook)) };
    })
    .filter((group) => !Array.isArray(group?.hooks) || group.hooks.length > 0);
}

export async function installClaude({ home = homedir(), entrypoint }) {
  const path = join(home, ".claude", "settings.json");
  const config = await readJson(path, {});
  config.value.hooks ??= {};
  const groups = removeGroups(config.value.hooks.PermissionRequest, isClaudeHandler);
  groups.push({
    matcher: "*",
    hooks: [
      {
        type: "command",
        command: entrypoint,
        args: ["permissions", "hook", "claude"],
        timeout: 330,
        statusMessage: STATUS_MESSAGE,
      },
    ],
  });
  config.value.hooks.PermissionRequest = groups;
  await atomicWrite(path, `${JSON.stringify(config.value, null, 2)}\n`, config.hash);
  return { agent: "claude", path };
}

export async function uninstallClaude({ home = homedir() }) {
  const path = join(home, ".claude", "settings.json");
  const config = await readJson(path, {});
  if (config.content === undefined) return { agent: "claude", removed: false };
  if (config.value.hooks?.PermissionRequest) {
    config.value.hooks.PermissionRequest = removeGroups(
      config.value.hooks.PermissionRequest,
      isClaudeHandler,
    );
    if (config.value.hooks.PermissionRequest.length === 0) {
      delete config.value.hooks.PermissionRequest;
    }
  }
  cleanEmptyHooks(config.value);
  await atomicWrite(path, `${JSON.stringify(config.value, null, 2)}\n`, config.hash);
  return { agent: "claude", removed: true };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export async function installCodex({ home = homedir(), entrypoint }) {
  const path = join(home, ".codex", "hooks.json");
  const config = await readJson(path, { description: "SHark permission approvals.", hooks: {} });
  config.value.description ??= "SHark permission approvals.";
  config.value.hooks ??= {};
  const groups = removeGroups(config.value.hooks.PermissionRequest, isCodexHandler);
  groups.push({
    hooks: [
      {
        type: "command",
        command: `${shellQuote(entrypoint)} permissions hook codex`,
        timeout: 330,
        statusMessage: STATUS_MESSAGE,
      },
    ],
  });
  config.value.hooks.PermissionRequest = groups;
  await atomicWrite(path, `${JSON.stringify(config.value, null, 2)}\n`, config.hash);
  const toml = await readOptional(join(home, ".codex", "config.toml"));
  const warnings = [];
  if (toml && /^\s*\[\[?hooks\./m.test(toml)) {
    warnings.push("Codex also has inline hooks; review merged definitions in /hooks.");
  }
  return {
    agent: "codex",
    path,
    warnings,
    next: "Open Codex /hooks and trust the SHark hook.",
  };
}

export async function uninstallCodex({ home = homedir() }) {
  const path = join(home, ".codex", "hooks.json");
  const config = await readJson(path, {});
  if (config.content === undefined) return { agent: "codex", removed: false };
  if (config.value.hooks?.PermissionRequest) {
    config.value.hooks.PermissionRequest = removeGroups(
      config.value.hooks.PermissionRequest,
      isCodexHandler,
    );
    if (config.value.hooks.PermissionRequest.length === 0) {
      delete config.value.hooks.PermissionRequest;
    }
  }
  cleanEmptyHooks(config.value);
  await atomicWrite(path, `${JSON.stringify(config.value, null, 2)}\n`, config.hash);
  return { agent: "codex", removed: true };
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function launchAgent({ home = homedir(), entrypoint }) {
  const stateDirectory = join(home, "Library", "Application Support", "SHark", "permission-bridge");
  const logDirectory = join(home, "Library", "Logs", "SHark");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(entrypoint)}</string>
    <string>permissions</string>
    <string>daemon</string>
    <string>opencode</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(`${dirname(process.execPath)}:${dirname(entrypoint)}:/usr/local/bin:/usr/bin:/bin`)}</string>
  </dict>
  <key>WorkingDirectory</key><string>${xml(stateDirectory)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>${xml(join(logDirectory, "permission-bridge.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDirectory, "permission-bridge.log"))}</string>
</dict>
</plist>
`;
}

export function openCodeV1Plugin({ entrypoint }) {
  return `import { spawn } from "node:child_process";

const sharkctl = ${JSON.stringify(entrypoint)};
const relevant = new Set(["server.connected", "permission.asked", "permission.updated"]);

export const SharkPermissionsV1Plugin = async ({ serverUrl, directory }) => ({
  event: async ({ event }) => {
    if (!relevant.has(event.type)) return;
    const child = spawn(sharkctl, ["permissions", "opencode-v1-event"], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.once("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ serverUrl: String(serverUrl), directory, event }));
    child.unref();
  },
});
`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} failed`))));
  });
}

export async function installOpenCode({
  home = homedir(),
  entrypoint,
  platform = process.platform,
  runCommand = run,
}) {
  if (platform !== "darwin") throw new Error("OpenCode service setup currently supports macOS.");
  const path = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const pluginPath = join(home, ".config", "opencode", "plugin", "shark-permissions-v1.js");
  const stateDirectory = join(home, "Library", "Application Support", "SHark", "permission-bridge");
  const logDirectory = join(home, "Library", "Logs", "SHark");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const currentPlugin = await readOptional(pluginPath);
  await atomicWrite(
    pluginPath,
    openCodeV1Plugin({ entrypoint }),
    currentPlugin === undefined ? undefined : digest(currentPlugin),
  );
  const current = await readOptional(path);
  await atomicWrite(
    path,
    launchAgent({ home, entrypoint }),
    current === undefined ? undefined : digest(current),
  );
  const domain = `gui/${process.getuid()}`;
  await runCommand("launchctl", ["bootout", domain, path]).catch(() => {});
  await runCommand("launchctl", ["bootstrap", domain, path]);
  const notifier = join(home, ".config", "opencode", "plugins", "mobile-code-notifications.js");
  const warnings = [];
  if (
    await access(notifier)
      .then(() => true)
      .catch(() => false)
  ) {
    warnings.push(
      "OpenCode already has a mobile notification plugin; permission alerts may duplicate.",
    );
  }
  return { agent: "opencode", path, pluginPath, warnings };
}

export async function uninstallOpenCode({
  home = homedir(),
  platform = process.platform,
  runCommand = run,
}) {
  const path = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const pluginPath = join(home, ".config", "opencode", "plugin", "shark-permissions-v1.js");
  if (platform === "darwin") {
    await runCommand("launchctl", ["bootout", `gui/${process.getuid()}`, path]).catch(() => {});
  }
  await rm(path, { force: true });
  await rm(pluginPath, { force: true });
  return { agent: "opencode", removed: true };
}

export async function installationStatus({ home = homedir() } = {}) {
  const claude = await readOptional(join(home, ".claude", "settings.json"));
  const codex = await readOptional(join(home, ".codex", "hooks.json"));
  const openCodePath = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const openCodeV1Path = join(home, ".config", "opencode", "plugin", "shark-permissions-v1.js");
  return {
    claude: claude ? claude.includes(STATUS_MESSAGE) : false,
    codex: codex ? codex.includes("permissions hook codex") : false,
    opencode: {
      v1: await access(openCodeV1Path)
        .then(() => true)
        .catch(() => false),
      v2: await access(openCodePath)
        .then(() => true)
        .catch(() => false),
    },
  };
}
