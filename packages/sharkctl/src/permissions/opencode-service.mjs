import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function registrationPath(file) {
  return (
    file ??
    join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "opencode", "service.json")
  );
}

export function headers(endpoint) {
  if (!endpoint?.auth) return undefined;
  return {
    authorization: `Basic ${Buffer.from(`${endpoint.auth.username}:${endpoint.auth.password}`).toString("base64")}`,
  };
}

export async function discover({ file } = {}) {
  let info;
  try {
    info = JSON.parse(await readFile(registrationPath(file), "utf8"));
  } catch {
    return undefined;
  }
  if (!info?.url || !Number.isInteger(info.pid)) return undefined;
  const endpoint = {
    url: info.url,
    ...(info.password
      ? { auth: { type: "basic", username: "opencode", password: info.password } }
      : {}),
  };
  try {
    const response = await fetch(new URL("/api/health", info.url), {
      headers: headers(endpoint),
      signal: AbortSignal.timeout(2_000),
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok || !body || body.pid !== info.pid) return undefined;
    if (info.version !== undefined && body.version !== info.version) return undefined;
    return endpoint;
  } catch {
    return undefined;
  }
}

export const Service = { discover, headers };
