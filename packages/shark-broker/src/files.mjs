import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { loadFileConfig } from "sharkctl/client";
import { BrokerError, requireValue } from "./errors.mjs";

export function defaultPaths(env = process.env) {
  return {
    config: path.join(
      env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
      "shark-broker",
      "hark-config.json",
    ),
    database: path.join(
      env.XDG_STATE_HOME || path.join(homedir(), ".local/state"),
      "shark-broker",
      "broker.sqlite",
    ),
  };
}

export async function protectedJSON(file) {
  requireValue(typeof file === "string" && path.isAbsolute(file), "protected_path");
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.nlink !== 1 ||
      (process.getuid && stat.uid !== process.getuid()) ||
      stat.size > 65_536
    )
      throw new Error();
    const buffer = Buffer.alloc(65_537);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65_536) throw new Error();
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
  } catch {
    throw new BrokerError(3, "protected_file_unavailable");
  } finally {
    await handle?.close();
  }
}

export async function loadBrokerConfig(file, env = process.env) {
  await protectedJSON(file);
  try {
    return await loadFileConfig(file, env);
  } catch {
    throw new BrokerError(3, "invalid_broker_config");
  }
}

export async function prepareDatabase(file) {
  requireValue(typeof file === "string" && path.isAbsolute(file), "database_path");
  const directory = path.dirname(file);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      (info.mode & 0o777) !== 0o700 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error();
    const handle = await open(
      file,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.nlink !== 1 ||
        (process.getuid && stat.uid !== process.getuid())
      )
        throw new Error();
    } finally {
      await handle.close();
    }
    return file;
  } catch {
    throw new BrokerError(3, "insecure_or_unavailable_state_path");
  }
}
