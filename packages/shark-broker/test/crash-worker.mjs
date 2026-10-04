// Integration-only child. All configuration arrives over private IPC.
import { Broker } from "../src/broker.mjs";
import { Store } from "../src/store.mjs";

process.once(
  "message",
  async ({ database, config, input, id, action, crashAt, clockOffset = 0 }) => {
    let store;
    try {
      const now = () => Date.now() + clockOffset;
      store = await Store.open(database, { now });
      const broker = new Broker({
        store,
        config,
        now,
        checkpoint: async (stage) => {
          if (stage === crashAt) {
            process.send({ stage });
            await new Promise(() => {});
          }
        },
      });
      const result = input
        ? await broker.register(input)
        : action === "discard"
          ? await broker.discard(id)
          : await broker.process(id, undefined, true);
      process.send({ result });
    } catch {
      process.send({ error: "worker_failed" });
    } finally {
      store?.close();
      process.disconnect();
    }
  },
);
