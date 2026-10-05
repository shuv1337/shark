import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runDaemon } from "../src/daemon.mjs";
import { ServiceManager, serviceDefinition } from "../src/service.mjs";
import { fixture } from "./fixture.mjs";

test("native executable lookup resolves Node without an injected process path", {
  skip: !["darwin", "linux"].includes(process.platform),
}, async () => {
  const manager = new ServiceManager();
  assert.equal(await manager.actualExecutable(process.pid), await realpath(process.execPath));
});

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
  let bootstrapFailuresLeft = 0;
  let unloadPrintsLeft = 0;
  let failedBootstrap = {
    code: 5,
    stdout: "",
    stderr: "Bootstrap failed: 5: Input/output error\n",
  };
  const bootstrapped = [];
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
      if (args[0] === "print" || args.includes("show")) {
        const pendingUnload = args[0] === "print" && !loaded && unloadPrintsLeft > 0;
        if (pendingUnload) unloadPrintsLeft -= 1;
        const visible = loaded || pendingUnload;
        return {
          code: visible ? 0 : 113,
          stdout:
            visible && running
              ? platform === "darwin"
                ? ` pid = ${process.pid}\n`
                : `ActiveState=active\nMainPID=${process.pid}\n`
              : "",
          stderr: "",
        };
      }
      if (args[0] === "bootout" || args.includes("disable")) {
        loaded = false;
        running = false;
      }
      if (args[0] === "bootstrap") bootstrapped.push(await readFile(manager.file, "utf8"));
      if (args[0] === "bootstrap" && bootstrapFailuresLeft > 0) {
        bootstrapFailuresLeft -= 1;
        return failedBootstrap;
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
    bootstrapped,
    set: (options) => {
      if ("loaded" in options) loaded = options.loaded;
      if ("linger" in options) linger = options.linger;
      if ("refresh" in options) refresh = options.refresh;
      if ("bootstrapFailures" in options) bootstrapFailuresLeft = options.bootstrapFailures;
      if ("unloadPrints" in options) unloadPrintsLeft = options.unloadPrints;
      if ("failedBootstrap" in options) failedBootstrap = options.failedBootstrap;
    },
  };
}

async function seedLaunchAgent(manager, content = manager.definition()) {
  await mkdir(path.dirname(manager.file), { recursive: true });
  await writeFile(manager.file, content);
  return content;
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
  await seedLaunchAgent(f.manager);
  f.set({ loaded: true });
  await f.manager.install(f.store);
  assert.ok(
    f.calls.findIndex(([, args]) => args[0] === "bootout") <
      f.calls.findIndex(([, args]) => args[0] === "bootstrap"),
  );
});

test("macOS reinstall waits until launchctl print drops the label", async (t) => {
  const f = await managerFixture(t);
  await seedLaunchAgent(f.manager);
  const started = f.now();
  f.set({ loaded: true, unloadPrints: 2 });
  assert.equal((await f.manager.install(f.store)).healthy, true);
  const bootoutAt = f.calls.findIndex(([, args]) => args[0] === "bootout");
  const bootstrapAt = f.calls.findIndex(([, args]) => args[0] === "bootstrap");
  const prints = f.calls
    .slice(bootoutAt + 1, bootstrapAt)
    .filter(([, args]) => args[0] === "print");
  assert.equal(prints.length, 3);
  assert.equal(f.calls.filter(([, args]) => args[0] === "bootstrap").length, 1);
  assert.ok(f.now() - started >= 200);
});

test("macOS reinstall outwaits a daemon that is slow to exit", async (t) => {
  const f = await managerFixture(t);
  await seedLaunchAgent(f.manager);
  const started = f.now();
  // 12 seconds of a visible label: longer than the bootstrap retries alone could absorb.
  f.set({ loaded: true, unloadPrints: 120 });
  assert.equal((await f.manager.install(f.store)).healthy, true);
  assert.equal(f.calls.filter(([, args]) => args[0] === "bootstrap").length, 1);
  assert.ok(f.now() - started >= 12_000);
});

test("macOS reinstall stops waiting for the label after the launchd exit timeout", async (t) => {
  const f = await managerFixture(t);
  await seedLaunchAgent(f.manager);
  const started = f.now();
  f.set({ loaded: true, unloadPrints: 10_000 });
  assert.equal((await f.manager.install(f.store)).healthy, true);
  const bootoutAt = f.calls.findIndex(([, args]) => args[0] === "bootout");
  const bootstrapAt = f.calls.findIndex(([, args]) => args[0] === "bootstrap");
  assert.ok(bootstrapAt > bootoutAt);
  const waited = f.now() - started;
  assert.ok(waited >= 25_000 && waited < 30_000, `waited ${waited}ms`);
});

test("macOS reinstall retries a bootstrap that races the previous bootout", async (t) => {
  const f = await managerFixture(t);
  const definition = await seedLaunchAgent(f.manager);
  const started = f.now();
  f.set({ loaded: true, bootstrapFailures: 2 });
  assert.equal((await f.manager.install(f.store)).healthy, true);
  assert.deepEqual(f.bootstrapped, [definition, definition, definition]);
  assert.equal(await readFile(f.manager.file, "utf8"), definition);
  assert.ok(f.now() - started >= 400);
});

test("macOS reinstall restores the previous plist when bootstrap keeps failing", async (t) => {
  const f = await managerFixture(t);
  const previous = `${f.manager.definition()}<!-- previous -->\n`;
  await seedLaunchAgent(f.manager, previous);
  f.set({
    loaded: true,
    bootstrapFailures: 5,
    failedBootstrap: {
      code: 5,
      stdout: "",
      stderr:
        "Bootstrap failed: 5: Input/output error\n/Users/example/Library/LaunchAgents/dev.shuv.shark.broker.plist\n",
    },
  });
  await assert.rejects(f.manager.install(f.store), (error) => {
    assert.equal(
      error.message,
      "service_manager_failed:bootstrap:input_output_error:definition_restored",
    );
    return true;
  });
  assert.equal(await readFile(f.manager.file, "utf8"), previous);
  assert.equal(f.bootstrapped.length, 6);
  assert.equal(f.bootstrapped[5], previous);
  assert.ok(f.bootstrapped.slice(0, 5).every((content) => content === f.manager.definition()));
});

test("macOS bootstrap reports the launchctl step without retrying a cold install", async (t) => {
  const f = await managerFixture(t);
  f.set({
    bootstrapFailures: 5,
    failedBootstrap: {
      code: 1,
      stdout: "",
      stderr: "Bootstrap failed: 1: Operation not permitted\n/Users/example/secret.plist\n",
    },
  });
  await assert.rejects(f.manager.install(f.store), {
    message: "service_manager_failed:bootstrap:operation_not_permitted",
  });
  assert.equal(f.bootstrapped.length, 1);
});

test("loaded macOS install does not retry a non-transient bootstrap failure", async (t) => {
  const f = await managerFixture(t);
  const previous = `${f.manager.definition()}<!-- previous -->\n`;
  await seedLaunchAgent(f.manager, previous);
  const started = f.now();
  f.set({
    loaded: true,
    bootstrapFailures: 1,
    failedBootstrap: {
      code: 1,
      stdout: "",
      stderr: "Bootstrap failed: 1: Operation not permitted\n",
    },
  });
  await assert.rejects(
    f.manager.install(f.store),
    /service_manager_failed:bootstrap:operation_not_permitted:definition_restored$/,
  );
  assert.equal(f.bootstrapped.length, 2);
  assert.equal(f.bootstrapped[0], f.manager.definition());
  assert.equal(f.bootstrapped[1], previous);
  assert.equal(await readFile(f.manager.file, "utf8"), previous);
  assert.equal(f.now(), started);
});

test("macOS reinstall does not claim recovery when the previous plist fails to boot", async (t) => {
  const f = await managerFixture(t);
  const previous = `${f.manager.definition()}<!-- previous -->\n`;
  await seedLaunchAgent(f.manager, previous);
  f.set({ loaded: true, bootstrapFailures: 20 });
  await assert.rejects(f.manager.install(f.store), {
    message: "service_manager_failed:bootstrap:input_output_error:restore_failed",
  });
  assert.equal(await readFile(f.manager.file, "utf8"), previous);
  assert.equal(f.bootstrapped.length, 10);
  assert.equal(f.bootstrapped[9], previous);
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
