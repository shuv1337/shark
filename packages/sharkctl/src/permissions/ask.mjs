import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WAIT_DURATION = "5m";
export const REQUIRED_PERMISSION_SCOPES = [
  "notifications:send",
  "interactions:create",
  "interactions:read",
];
const sharkctlPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "sharkctl.mjs");

function safeText(value, fallback, maxLength = 48) {
  const printable = Array.from(String(value ?? fallback), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  const text = printable.replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maxLength);
}

export function permissionSummary({ agent, cwd, toolName, resourceCount }) {
  const agentName = safeText(agent, "Coding agent", 32);
  const project = safeText(basename(cwd || "") || "project", "project", 48);
  const tool = safeText(toolName, "tool", 48);
  const count = Number.isInteger(resourceCount) && resourceCount > 0 ? resourceCount : 1;
  return {
    title: `${agentName} permission`,
    body: `${agentName} requests ${tool} permission in ${project} for ${count} resource${count === 1 ? "" : "s"}. Allow once?`,
  };
}

export function stableIdempotencyKey(prefix, values) {
  const digest = createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 40);
  return `${prefix}-${digest}`;
}

export function uniqueIdempotencyKey(prefix) {
  return stableIdempotencyKey(prefix, [randomUUID()]);
}

function sharkEnvironment() {
  // Permission hooks run inside coding-agent processes. Use the user-owned
  // credential file (and an explicit HARK_CONFIG override) rather than inheriting
  // HARK_TOKEN or HARK_API_URL from the agent environment.
  return {
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.USER ? { USER: process.env.USER } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    ...(process.env.HARK_CONFIG ? { HARK_CONFIG: process.env.HARK_CONFIG } : {}),
    ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}),
    ...(process.env.APPDATA ? { APPDATA: process.env.APPDATA } : {}),
  };
}

function runSharkctl(args, input, captureOutput = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [sharkctlPath, ...args], {
      env: sharkEnvironment(),
      stdio: [input === undefined ? "ignore" : "pipe", captureOutput ? "pipe" : "ignore", "ignore"],
    });
    const chunks = [];
    if (captureOutput) {
      child.stdout.on("data", (chunk) => {
        if (chunks.reduce((total, item) => total + item.length, 0) < 1024 * 1024)
          chunks.push(chunk);
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
        output: captureOutput ? Buffer.concat(chunks).toString("utf8") : "",
      });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function sharkAuthenticationStatus() {
  const result = await runSharkctl(["auth", "status"], undefined, true);
  if (result.code !== 0) {
    return { authenticated: false, scopes: [], missingScopes: [...REQUIRED_PERMISSION_SCOPES] };
  }
  const body = JSON.parse(result.output);
  const scopes = Array.isArray(body?.scopes)
    ? body.scopes
    : Array.isArray(body?.token?.scopes)
      ? body.token.scopes
      : [];
  return {
    authenticated: body?.authenticated === true,
    scopes,
    missingScopes: REQUIRED_PERMISSION_SCOPES.filter((scope) => !scopes.includes(scope)),
  };
}

export async function checkSharkAuthentication() {
  const status = await sharkAuthenticationStatus();
  return status.authenticated && status.missingScopes.length === 0;
}

export async function askSharkPermission({ title, body, idempotencyKey }) {
  try {
    const result = await runSharkctl(
      [
        "notify",
        "ask",
        "--stdin",
        "--approval",
        "--wait",
        "--timeout",
        WAIT_DURATION,
        "--expires-in",
        WAIT_DURATION,
        "--idempotency-key",
        idempotencyKey,
      ],
      JSON.stringify({ prompt: body, title }),
    );
    return result.code === 0 ? "approved" : "denied";
  } catch {
    return "denied";
  }
}
