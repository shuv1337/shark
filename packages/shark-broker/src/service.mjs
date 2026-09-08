import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { BrokerError, requireValue } from "./errors.mjs";

const exec = promisify(execFile);
const label = "dev.shuv.shark.broker";
const marker = "Managed by SHark sharkd v1";
const validPath = (value) =>
  typeof value === "string" && path.isAbsolute(value) && !/[\0\r\n]/.test(value);
const xml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const systemd = (value) =>
  `"${value.replaceAll("$", "$$$$").replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

export function serviceDefinition({ platform, node, entry, config, database }) {
  requireValue([node, entry, config, database].every(validPath), "service_paths");
  const args = [node, entry, "run", "--config", config, "--database", database];
  if (platform === "linux")
    return `# ${marker}\n[Unit]\nDescription=SHark reply broker\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStart=${args.map(systemd).join(" ")}\nUnsetEnvironment=HARK_TOKEN HARK_API_URL HARK_CONFIG\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=20\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
  if (platform === "darwin") {
    // launchd has no per-job UnsetEnvironment equivalent; env -u removes only
    // the three client overrides before the absolute Node entry point starts.
    const launchArgs = [
      "/usr/bin/env",
      "-u",
      "HARK_TOKEN",
      "-u",
      "HARK_API_URL",
      "-u",
      "HARK_CONFIG",
      ...args,
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${marker} -->\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array>${launchArgs.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>\n<key>Umask</key><integer>63</integer>\n</dict></plist>\n`;
  }
  throw new BrokerError(2, "unsupported_service_platform");
}

async function execute(command, args) {
  try {
    const result = await exec(command, args, { timeout: 15_000, maxBuffer: 256 * 1024 });
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}
export class ServiceManager {
  constructor({
    platform = process.platform,
    home = homedir(),
    uid = process.getuid?.(),
    username = userInfo().username,
    node = process.execPath,
    entry,
    config,
    database,
    run = execute,
    now = Date.now,
    sleep = delay,
    processPath,
  } = {}) {
    Object.assign(this, {
      platform,
      home,
      uid,
      username,
      node,
      entry,
      config,
      database,
      run,
      now,
      sleep,
      processPath,
    });
    this.file =
      platform === "linux"
        ? path.join(home, ".config/systemd/user/sharkd.service")
        : path.join(home, "Library/LaunchAgents", `${label}.plist`);
  }
  definition() {
    return serviceDefinition(this);
  }
  async ownedFile({ required = false, matching = false } = {}) {
    try {
      const info = await lstat(this.file);
      if (!info.isFile() || (process.getuid && info.uid !== process.getuid()))
        throw new BrokerError(3, "unowned_service_definition");
      const content = await readFile(this.file, "utf8");
      if (!content.includes(marker)) throw new BrokerError(3, "unowned_service_definition");
      if (matching && content !== this.definition())
        throw new BrokerError(3, "service_definition_mismatch");
      return true;
    } catch (error) {
      if (error.code === "ENOENT" && !required) return false;
      if (error.code === "ENOENT") throw new BrokerError(4, "service_not_installed");
      throw error;
    }
  }
  async command(command, args, { allowMissing = false } = {}) {
    const result = await this.run(command, args);
    if (result.code !== 0 && !(allowMissing && [3, 5, 113].includes(result.code)))
      throw new BrokerError(1, "service_manager_failed");
    return result;
  }
  async runtimeCheck() {
    const script =
      'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<13))process.exit(1);const {DatabaseSync}=await import("node:sqlite");const db=new DatabaseSync(":memory:");db.close();console.log(process.versions.node)';
    const result = await this.run(this.node, ["--input-type=module", "-e", script]);
    const lines = result.stderr.split("\n").filter(Boolean);
    if (
      result.code !== 0 ||
      lines.some(
        (line) =>
          !/ExperimentalWarning: SQLite is an experimental feature|Use .*--trace-warnings/.test(
            line,
          ),
      )
    )
      throw new BrokerError(1, "node_sqlite_runtime_unavailable");
    return result.stdout.trim();
  }
  async status() {
    const installed = await this.ownedFile();
    if (!installed) return { installed: false, loaded: false, running: false, pid: null };
    if (this.platform === "linux") {
      const result = await this.run("/usr/bin/systemctl", [
        "--user",
        "show",
        "sharkd.service",
        "--property=ActiveState,MainPID",
      ]);
      const pid = Number(result.stdout.match(/^MainPID=(\d+)$/m)?.[1]);
      return {
        installed: true,
        loaded: result.code === 0,
        running: result.code === 0 && /^ActiveState=active$/m.test(result.stdout) && pid > 0,
        pid: pid > 0 ? pid : null,
      };
    }
    const result = await this.run("/bin/launchctl", ["print", `gui/${this.uid}/${label}`]);
    const pid = Number(result.stdout.match(/^\s*pid = (\d+)\s*$/m)?.[1]);
    return {
      installed: true,
      loaded: result.code === 0,
      running: result.code === 0 && pid > 0,
      pid: pid > 0 ? pid : null,
    };
  }
  async actualExecutable(pid) {
    if (this.processPath) return this.processPath(pid);
    try {
      const value =
        this.platform === "linux"
          ? await readlink(`/proc/${pid}/exe`)
          : (await this.run("/bin/ps", ["-p", String(pid), "-o", "comm="])).stdout.trim();
      return await realpath(value);
    } catch {
      return undefined;
    }
  }
  async health(store, { previousInstance } = {}) {
    const manager = await this.status();
    const state = store.daemonState();
    let healthy = false;
    if (
      manager.running &&
      state &&
      manager.pid === state.pid &&
      state.entryPath === this.entry &&
      this.now() - state.heartbeatAt >= 0 &&
      this.now() - state.heartbeatAt <= 90_000 &&
      state.instanceID !== previousInstance
    ) {
      try {
        healthy =
          (await this.actualExecutable(state.pid)) === (await realpath(this.node)) &&
          (await realpath(state.execPath)) === (await realpath(this.node));
      } catch {
        healthy = false;
      }
    }
    return {
      ...manager,
      healthy,
      heartbeatAt: state?.heartbeatAt ?? null,
      lastPollAt: state?.lastPollAt ?? null,
      lastErrorClass: state?.lastErrorClass ?? null,
      counts: store.counts(),
    };
  }
  async waitHealthy(store, previousInstance) {
    const deadline = this.now() + 20_000;
    do {
      const health = await this.health(store, { previousInstance });
      if (health.healthy) return health;
      await this.sleep(250);
    } while (this.now() < deadline);
    throw new BrokerError(6, "service_heartbeat_not_ready");
  }
  async install(store) {
    this.definition();
    await this.runtimeCheck();
    if (this.platform === "linux") {
      const result = await this.run("/usr/bin/loginctl", [
        "show-user",
        String(this.uid),
        "--property=Linger",
        "--value",
      ]);
      if (result.code !== 0 || result.stdout.trim() !== "yes")
        throw new BrokerError(
          1,
          `linux_lingering_disabled: loginctl enable-linger ${this.username}`,
        );
    }
    await this.ownedFile();
    const previous = store.daemonState()?.instanceID;
    const priorStatus = await this.status();
    const running = priorStatus.running;
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, this.definition(), { flag: "wx", mode: 0o600 });
      await rename(temp, this.file);
    } finally {
      await rm(temp, { force: true });
    }
    if (this.platform === "linux") {
      await this.command("/usr/bin/systemctl", ["--user", "daemon-reload"]);
      await this.command("/usr/bin/systemctl", ["--user", "enable", "--now", "sharkd.service"]);
      if (running)
        await this.command("/usr/bin/systemctl", ["--user", "restart", "sharkd.service"]);
    } else {
      if (priorStatus.loaded)
        await this.command("/bin/launchctl", ["bootout", `gui/${this.uid}/${label}`]);
      await this.command("/bin/launchctl", ["bootstrap", `gui/${this.uid}`, this.file]);
    }
    return this.waitHealthy(store, previous);
  }
  async restart(store) {
    await this.ownedFile({ required: true, matching: true });
    await this.runtimeCheck();
    const previous = store.daemonState()?.instanceID;
    if (this.platform === "linux")
      await this.command("/usr/bin/systemctl", ["--user", "restart", "sharkd.service"]);
    else await this.command("/bin/launchctl", ["kickstart", "-k", `gui/${this.uid}/${label}`]);
    return this.waitHealthy(store, previous);
  }
  async uninstall() {
    if (!(await this.ownedFile())) return { installed: false, statePreserved: true };
    if (this.platform === "linux")
      await this.command("/usr/bin/systemctl", ["--user", "disable", "--now", "sharkd.service"]);
    else
      await this.command("/bin/launchctl", ["bootout", `gui/${this.uid}/${label}`], {
        allowMissing: true,
      });
    await rm(this.file);
    if (this.platform === "linux")
      await this.command("/usr/bin/systemctl", ["--user", "daemon-reload"]);
    return { installed: false, statePreserved: true };
  }
}
