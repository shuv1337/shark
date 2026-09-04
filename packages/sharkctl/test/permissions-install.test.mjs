import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  installClaude,
  installCodex,
  installOpenCode,
  uninstallClaude,
  uninstallCodex,
  uninstallOpenCode,
} from "../src/permissions/install.mjs";

async function temporaryHome() {
  return mkdtemp(join(tmpdir(), "shark-permissions-"));
}

test("Claude install is additive, idempotent, and surgically reversible", async () => {
  const home = await temporaryHome();
  const directory = join(home, ".claude");
  const path = join(directory, "settings.json");
  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [] }] } })}\n`);

  await installClaude({ home, entrypoint: "/opt/shark/sharkctl.mjs" });
  await installClaude({ home, entrypoint: "/opt/shark/sharkctl.mjs" });
  let value = JSON.parse(await readFile(path, "utf8"));
  assert.equal(value.theme, "dark");
  assert.equal(value.hooks.Stop.length, 1);
  assert.equal(value.hooks.PermissionRequest.length, 1);

  await uninstallClaude({ home });
  value = JSON.parse(await readFile(path, "utf8"));
  assert.equal(value.theme, "dark");
  assert.equal(value.hooks.Stop.length, 1);
  assert.equal(value.hooks.PermissionRequest, undefined);
});

test("Codex install preserves existing hooks and removes only SHark", async () => {
  const home = await temporaryHome();
  const directory = join(home, ".codex");
  const path = join(directory, "hooks.json");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ description: "Mine", hooks: { Stop: [{ hooks: [{ type: "command", command: "other" }] }] } })}\n`,
  );

  const installed = await installCodex({ home, entrypoint: "/opt/shark/sharkctl.mjs" });
  assert.match(installed.next, /\/hooks/);
  let value = JSON.parse(await readFile(path, "utf8"));
  assert.equal(value.description, "Mine");
  assert.equal(value.hooks.Stop.length, 1);
  assert.equal(value.hooks.PermissionRequest.length, 1);
  assert.match(value.hooks.PermissionRequest[0].hooks[0].command, /sharkctl/);

  await uninstallCodex({ home });
  value = JSON.parse(await readFile(path, "utf8"));
  assert.equal(value.hooks.Stop.length, 1);
  assert.equal(value.hooks.PermissionRequest, undefined);
});

test("OpenCode install writes a credential-free LaunchAgent and is reversible", async () => {
  const home = await temporaryHome();
  const calls = [];
  const runCommand = async (command, args) => calls.push([command, args]);
  const result = await installOpenCode({
    home,
    entrypoint: "/opt/shark/sharkctl.mjs",
    platform: "darwin",
    runCommand,
  });
  const plist = await readFile(result.path, "utf8");
  const plugin = await readFile(result.pluginPath, "utf8");
  assert.match(plist, /daemon/);
  assert.match(plist, /opencode/);
  assert.match(plist, /dev\.shuv\.shark-permission-bridge/);
  assert.doesNotMatch(plist, /token|credential|secret/i);
  assert.match(plugin, /opencode-v1-event/);
  assert.match(plugin, /SharkPermissionsV1Plugin/);
  assert.doesNotMatch(plugin, /token|credential|secret/i);
  assert.equal(
    calls.some(([command, args]) => command === "launchctl" && args[0] === "bootstrap"),
    true,
  );

  await uninstallOpenCode({ home, platform: "darwin", runCommand });
  await assert.rejects(readFile(result.path, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(result.pluginPath, "utf8"), { code: "ENOENT" });
});

test("installers reject destructive JSON shapes without changing the file", async () => {
  const home = await temporaryHome();
  const directory = join(home, ".claude");
  const path = join(directory, "settings.json");
  await mkdir(directory, { recursive: true });
  await writeFile(path, "[]\n");
  await assert.rejects(
    installClaude({ home, entrypoint: "/opt/shark/sharkctl.mjs" }),
    /Expected a JSON object/,
  );
  assert.equal(await readFile(path, "utf8"), "[]\n");
});
