import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runDaemon } from "../src/daemon.mjs";
import { ServiceManager, serviceDefinition } from "../src/service.mjs";
import { fixture } from "./fixture.mjs";

test("service definitions quote absolute paths and clear ambient credentials", () => {
  const args = {
    node: '/tmp/Node % "&/node',
    entry: "/tmp/app/sharkd.mjs",
    config: "/tmp/private/config.json",
    database: "/tmp/private/broker.db",
  };
  assert.match(serviceDefinition({ ...args, platform: "linux" }), /Node %%/);
  assert.match(
    serviceDefinition({ ...args, platform: "linux" }),
    /UnsetEnvironment=HARK_TOKEN HARK_API_URL HARK_CONFIG/,
  );
  assert.match(serviceDefinition({ ...args, platform: "darwin" }), /&quot;&amp;/);
  assert.match(
    serviceDefinition({ ...args, platform: "darwin" }),
    /<string>-u<\/string><string>HARK_TOKEN/,
  );
  assert.throws(
    () => serviceDefinition({ ...args, node: "node", platform: "linux" }),
    /service_paths/,
  );
});

async function managerFixture(t, platform = "darwin") {
  const f = await fixture(t);
  const calls = [];
  let loaded = false;
  let running = false;
  let linger = true;
  let refresh = true;
  const entry = path.join(f.root, "sharkd.mjs");
  const manager = new ServiceManager({
    platform,
    home: f.root,
    uid: 501,
    username: "synthetic",
    entry,
    config: path.join(f.root, "config.json"),
    database: f.file,
    now: f.now,
    processPath: async () => process.execPath,
    sleep: async (ms) => f.advance(ms),
    run: async (command, args) => {
      calls.push([command, args]);
      if (command === process.execPath)
        return { code: 0, stdout: process.versions.node, stderr: "" };
      if (command.endsWith("loginctl"))
        return { code: 0, stdout: linger ? "yes" : "no", stderr: "" };
      if (args[0] === "print" || args.includes("show"))
        return {
          code: loaded ? 0 : 113,
          stdout: running
            ? platform === "darwin"
              ? ` pid = ${process.pid}\n`
              : `ActiveState=active\nMainPID=${process.pid}\n`
            : "",
          stderr: "",
        };
      if (args[0] === "bootout" || args.includes("disable")) {
        loaded = false;
        running = false;
      }
      if (
        args[0] === "bootstrap" ||
        args[0] === "kickstart" ||
        args.includes("enable") ||
        args.includes("restart")
      ) {
        loaded = true;
        running = true;
        if (refresh)
          f.store.acquireDaemon(
            {
              instanceID: `instance-${calls.length}`,
              pid: process.pid,
              execPath: process.execPath,
              entryPath: entry,
            },
            () => false,
          );
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  return {
    ...f,
    manager,
    calls,
    set: (options) => {
      if ("loaded" in options) loaded = options.loaded;
      if ("linger" in options) linger = options.linger;
      if ("refresh" in options) refresh = options.refresh;
    },
  };
}

test("Linux lingering failure happens before writing or enabling a service", async (t) => {
  const f = await managerFixture(t, "linux");
  f.set({ linger: false });
  await assert.rejects(f.manager.install(f.store), /linux_lingering_disabled/);
  await assert.rejects(access(f.manager.file));
  assert.equal(
    f.calls.some(([, args]) => args.includes("enable")),
    false,
  );
});

for (const platform of ["linux", "darwin"])
  test(`${platform} lifecycle verifies new instance and preserves state`, async (t) => {
    const f = await managerFixture(t, platform);
    assert.equal((await f.manager.install(f.store)).healthy, true);
    const first = f.store.daemonState().instanceID;
    assert.equal((await f.manager.restart(f.store)).healthy, true);
    assert.notEqual(f.store.daemonState().instanceID, first);
    f.set({ refresh: false });
    await assert.rejects(f.manager.restart(f.store), /service_heartbeat_not_ready/);
    f.advance(100_000);
    assert.equal((await f.manager.health(f.store)).healthy, false);
    assert.deepEqual(await f.manager.uninstall(), { installed: false, statePreserved: true });
    await access(f.file);
  });

test("macOS reinstall boots out a loaded job even when no process runs", async (t) => {
  const f = await managerFixture(t);
  await mkdir(path.dirname(f.manager.file), { recursive: true });
  await writeFile(f.manager.file, f.manager.definition());
  f.set({ loaded: true });
  await f.manager.install(f.store);
  assert.ok(
    f.calls.findIndex(([, args]) => args[0] === "bootout") <
      f.calls.findIndex(([, args]) => args[0] === "bootstrap"),
  );
});

test("unrecognized service files cannot be overwritten or removed", async (t) => {
  const f = await managerFixture(t);
  await mkdir(path.dirname(f.manager.file), { recursive: true });
  await writeFile(f.manager.file, "user service");
  await assert.rejects(f.manager.install(f.store), /unowned_service_definition/);
  await assert.rejects(f.manager.uninstall(), /unowned_service_definition/);
  assert.equal(await readFile(f.manager.file, "utf8"), "user service");
});

test("idle daemon heartbeat stays current without falsely claiming a poll", async (t) => {
  const f = await fixture(t);
  const stop = new AbortController();
  let loops = 0;
  await runDaemon({
    store: f.store,
    broker: f.broker(),
    entryPath: "/synthetic/sharkd.mjs",
    signal: stop.signal,
    sleep: async () => {
      f.advance(31_000);
      if (++loops === 3) stop.abort();
    },
  });
  const state = f.store.daemonState();
  assert.equal(state.lastPollAt, null);
  assert.equal(state.heartbeatAt, f.now() - 31_000);
  assert.equal(state.lastErrorClass, null);
});

test("health rejects PID and executable mismatches despite a fresh heartbeat", async (t) => {
  const f = await managerFixture(t);
  await f.manager.install(f.store);
  f.manager.processPath = async () => "/another/executable";
  assert.equal((await f.manager.health(f.store)).healthy, false);
  f.manager.processPath = async () => process.execPath;
  f.store.db.prepare("UPDATE daemon_state SET pid=999999").run();
  assert.equal((await f.manager.health(f.store)).healthy, false);
});

test("systemd definitions keep dollar expressions literal", () => {
  const definition = serviceDefinition({
    platform: "linux",
    node: process.execPath,
    entry: "/tmp/$NAME/sharkd.mjs",
    config: "/tmp/config.json",
    database: "/tmp/state.db",
  });
  assert.ok(definition.includes("/tmp/$$NAME/sharkd.mjs"));
});
