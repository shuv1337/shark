import { BrokerError } from "../errors.mjs";
import { CodexAdapter } from "./codex.mjs";
import { OpenCodeAdapter } from "./opencode-v2.mjs";

export class AdapterRouter {
  constructor() {
    this.adapters = { "opencode-v2": new OpenCodeAdapter(), codex: new CodexAdapter() };
  }
  forSession(session) {
    const adapter = this.adapters[session.harness];
    if (!adapter) throw new BrokerError(2, "unsupported_harness");
    return adapter;
  }
}
