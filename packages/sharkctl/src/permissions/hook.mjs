import { askSharkPermission, permissionSummary, uniqueIdempotencyKey } from "./ask.mjs";

const MAX_INPUT_BYTES = 1024 * 1024;

export async function readHookInput(stream = process.stdin) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error("Hook input is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function hookDecision(_agent, allow, message = "Denied through SHark.") {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: allow ? { behavior: "allow" } : { behavior: "deny", message },
    },
  };
}

export async function handlePermissionHook(agent, input, ask = askSharkPermission) {
  if (input?.hook_event_name !== "PermissionRequest") {
    return hookDecision(agent, false, "Invalid permission request; denied by SHark policy.");
  }
  const agentName = agent === "claude" ? "Claude Code" : "Codex";
  const summary = permissionSummary({
    agent: agentName,
    cwd: input.cwd,
    toolName: input.tool_name,
    resourceCount: 1,
  });
  const decision = await ask({
    ...summary,
    idempotencyKey: uniqueIdempotencyKey(`${agent}-permission`),
  });
  return hookDecision(agent, decision === "approved");
}

export async function runPermissionHook(agent) {
  try {
    const input = await readHookInput();
    return await handlePermissionHook(agent, input);
  } catch {
    return hookDecision(agent, false, "Permission bridge failed; denied by policy.");
  }
}
