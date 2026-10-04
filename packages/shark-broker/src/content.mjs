import { requireValue } from "./errors.mjs";

export function text(value, field, max, { empty = false } = {}) {
  requireValue(typeof value === "string", field);
  const result = value.trim();
  requireValue((empty || result.length > 0) && result.length <= max, field);
  return result;
}
export function truncate(value, maximum) {
  let length = 0;
  for (const character of value) {
    if (length + character.length > maximum) break;
    length += character.length;
  }
  return value.slice(0, length);
}
export function completion(input) {
  const title = text(input.title ?? "SHark", "title", 80);
  const key = text(input.idempotencyKey, "idempotency_key", 200);
  const summary = text(input.summary, "summary", 65_536, { empty: input.question !== undefined });
  if (input.question === undefined)
    return { key, kind: "notification", content: { title, body: truncate(summary, 2000) } };
  const question = text(input.question, "question", 2000);
  const prefix = truncate(summary, Math.max(0, 2000 - question.length - 2));
  return {
    key,
    kind: "deferred",
    question,
    content: { title, kind: "reply", prompt: prefix ? `${prefix}\n\n${question}` : question },
  };
}
export function expiry(value = 8 * 3600) {
  requireValue(Number.isInteger(value) && value >= 30 && value <= 86_400, "expiry");
  return value;
}
export function selectDevices(devices) {
  requireValue(Array.isArray(devices), "device_inventory");
  return devices
    .filter(
      (device) =>
        device.active === true &&
        ["ios", "macos"].includes(device.platform) &&
        typeof device.id === "string" &&
        device.id.length > 0 &&
        device.id.length <= 100 &&
        Number.isFinite(Date.parse(device.lastSeenAt)),
    )
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) || a.id.localeCompare(b.id))
    .filter(
      (device, index, all) => all.findIndex((candidate) => candidate.id === device.id) === index,
    )
    .slice(0, 50)
    .map((device) => device.id);
}
