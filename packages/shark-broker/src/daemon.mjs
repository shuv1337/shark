import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { BrokerError, safeError } from "./errors.mjs";

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

export async function runDaemon({
  broker,
  store,
  entryPath,
  signal,
  once = false,
  sleep = delay,
  isAlive = isProcessAlive,
}) {
  if (once) {
    const results = await broker.tick();
    return { processed: results.length, counts: store.counts() };
  }
  const instanceID = randomUUID();
  store.acquireDaemon(
    { instanceID, pid: process.pid, execPath: process.execPath, entryPath },
    isAlive,
  );
  let lost;
  const timer = setInterval(() => {
    try {
      store.heartbeat(instanceID, { error: store.daemonState()?.lastErrorClass ?? null });
    } catch (error) {
      lost = error;
    }
  }, 30_000);
  try {
    while (!signal?.aborted) {
      if (lost) throw lost;
      try {
        const results = await broker.tick();
        const failed = results.find((result) => result.code !== 0);
        store.heartbeat(instanceID, {
          polled: broker.lastPollAt !== undefined,
          error: failed ? (store.get(failed.id)?.lastError ?? "work_pending") : null,
        });
        broker.lastPollAt = undefined;
      } catch (error) {
        if (
          error instanceof BrokerError &&
          ["daemon_ownership_lost", "lease_lost"].includes(error.message)
        )
          throw error;
        store.heartbeat(instanceID, { error: safeError(error).diagnostic });
      }
      try {
        await sleep(1000, undefined, { signal });
      } catch (error) {
        if (!signal?.aborted) throw error;
      }
    }
  } finally {
    clearInterval(timer);
  }
  return { stopped: true };
}
