import { createHash } from "node:crypto";
import { BrokerError } from "./errors.mjs";

export function canonical(value, depth = 0) {
  if (depth > 8) throw new BrokerError(2, "json_too_deep");
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key], depth + 1)]),
    );
  }
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  throw new BrokerError(2, "invalid_json_value");
}

export const stableJSON = (value) => JSON.stringify(canonical(value));
export const digest = (value) => createHash("sha256").update(stableJSON(value)).digest("hex");
