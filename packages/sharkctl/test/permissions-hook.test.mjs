import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { permissionSummary } from "../src/permissions/ask.mjs";
import { handlePermissionHook, hookDecision } from "../src/permissions/hook.mjs";

test("summaries exclude raw commands and absolute paths", () => {
  const summary = permissionSummary({
    agent: "Claude Code",
    cwd: "/Users/example/private/shark",
    toolName: "Bash",
    resourceCount: 2,
  });
  assert.equal(summary.title, "Claude Code permission");
  assert.match(summary.body, /Bash permission in shark for 2 resources/);
  assert.doesNotMatch(summary.body, /Users|private/);
  assert.equal(summary.imageUrl, undefined);
  assert.equal(
    permissionSummary({ agent: "Codex", cwd: "/tmp/shark", toolName: "Bash" }).imageUrl,
    undefined,
  );
});

test("Claude and Codex hooks map only explicit approval to allow", async () => {
  const input = {
    hook_event_name: "PermissionRequest",
    cwd: "/tmp/shark",
    tool_name: "Bash",
    tool_input: { command: "echo secret-value" },
  };
  let sent;
  const approved = await handlePermissionHook("claude", input, async (request) => {
    sent = request;
    return "approved";
  });
  assert.deepEqual(approved, hookDecision("claude", true));
  assert.doesNotMatch(JSON.stringify(sent), /secret-value/);

  const denied = await handlePermissionHook("codex", input, async () => "denied");
  assert.deepEqual(denied, hookDecision("codex", false));
});

test("invalid hook input fails closed", async () => {
  const result = await handlePermissionHook("claude", { hook_event_name: "Stop" }, async () => {
    throw new Error("must not be called");
  });
  assert.equal(result.hookSpecificOutput.decision.behavior, "deny");
});

test("sharkctl prints the decision envelope required by Claude and Codex", async () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn(
    process.execPath,
    [join(packageRoot, "bin", "sharkctl.mjs"), "permissions", "hook", "claude"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdin.end(JSON.stringify({ hook_event_name: "Stop" }));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
  const output = JSON.parse(Buffer.concat(stdout).toString("utf8"));
  assert.equal(output.hookSpecificOutput.hookEventName, "PermissionRequest");
  assert.equal(output.hookSpecificOutput.decision.behavior, "deny");
  assert.equal(output.ok, undefined);
});
