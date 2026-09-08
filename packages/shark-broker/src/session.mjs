import path from "node:path";
import { BrokerError, requireValue } from "./errors.mjs";
import { protectedJSON } from "./files.mjs";
import { stableJSON } from "./json.mjs";

export function validateSession(value) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "session_reference");
  requireValue(Buffer.byteLength(stableJSON(value)) <= 65_536, "session_reference_size");
  requireValue(value.version === 1, "session_version");
  if (value.harness !== "opencode-v2") throw new BrokerError(2, "unsupported_harness");
  requireValue(
    typeof value.sessionId === "string" &&
      value.sessionId.startsWith("ses_") &&
      value.sessionId.length <= 512,
    "session_id",
  );
  requireValue(
    value.cwd === undefined ||
      (typeof value.cwd === "string" && path.isAbsolute(value.cwd) && value.cwd.length <= 4096),
    "session_cwd",
  );
  const data = value.adapterData;
  requireValue(
    data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      Buffer.byteLength(stableJSON(data)) <= 16_384,
    "adapter_data",
  );
  requireValue(
    Object.keys(data).every((key) => ["serverUrl", "authFile", "workspaceID"].includes(key)),
    "adapter_fields",
  );
  requireValue(
    typeof data.authFile === "string" &&
      path.isAbsolute(data.authFile) &&
      data.authFile.length <= 4096,
    "native_auth_file",
  );
  requireValue(
    data.workspaceID === undefined ||
      (typeof data.workspaceID === "string" &&
        data.workspaceID.length > 0 &&
        data.workspaceID.length <= 512),
    "workspace_id",
  );
  let url;
  try {
    url = new URL(data.serverUrl);
  } catch {
    throw new BrokerError(2, "native_server_url");
  }
  requireValue(
    url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/",
    "native_server_url",
  );
  requireValue(
    Object.keys(value).every((key) =>
      ["version", "harness", "sessionId", "cwd", "adapterData", "generation"].includes(key),
    ),
    "session_fields",
  );
  requireValue(
    value.generation === undefined || Number.isSafeInteger(value.generation),
    "session_generation",
  );
  return {
    version: 1,
    harness: value.harness,
    sessionId: value.sessionId,
    ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    ...(value.generation === undefined ? {} : { generation: value.generation }),
    adapterData: { ...data, serverUrl: url.origin },
  };
}
export const loadSession = async (file) => validateSession(await protectedJSON(file));
