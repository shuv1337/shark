import { Broker } from "./broker.mjs";
import { loadBrokerConfig } from "./files.mjs";
import { Store } from "./store.mjs";

export { BrokerError } from "./errors.mjs";
export { loadSession, validateSession } from "./session.mjs";
export const API_VERSION = 1;

// Local, trusted host seam. No network listener and no mobile credentials.
// Call close after outstanding operations finish. The database remains private.
export async function openBroker({ configPath, databasePath, ...options }) {
  const config = await loadBrokerConfig(configPath);
  const store = await Store.open(databasePath);
  const broker = new Broker({ ...options, config, store });
  return {
    version: API_VERSION,
    complete: (input) => broker.register(input),
    registerActive: (input) => broker.registerActive(input),
    poll: () => broker.tick(),
    retry: (id) => broker.retry(id),
    discard: (id) => broker.discard(id),
    list: () => store.list(),
    close: () => store.close(),
  };
}
