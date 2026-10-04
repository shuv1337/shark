import assert from "node:assert/strict";
import test from "node:test";
import { completion, expiry, selectDevices } from "../src/content.mjs";

test("production completion template preserves normalized question and UTF-16 budgets", () => {
  for (const size of [1, 1996, 1997, 1998, 1999, 2000]) {
    const question = "q".repeat(size);
    const row = completion({
      summary: " 😀summary ",
      question: ` ${question} `,
      title: " title ",
      idempotencyKey: " key ",
    });
    assert.equal(row.key, "key");
    assert.equal(row.content.title, "title");
    assert.ok(row.content.prompt.length <= 2000);
    assert.ok(row.content.prompt.endsWith(question));
    assert.equal(row.content.prompt.includes("\ud83d\n"), false);
    if (size >= 1997) assert.equal(row.content.prompt, question);
  }
  assert.equal(
    completion({ summary: "", question: " Question? ", idempotencyKey: "key" }).content.prompt,
    "Question?",
  );
  assert.equal(
    completion({ summary: "x".repeat(2001), idempotencyKey: "key" }).content.body.length,
    2000,
  );
  for (const field of [
    { question: " " },
    { question: "x".repeat(2001) },
    { title: "x".repeat(81) },
    { idempotencyKey: " " },
  ]) {
    assert.throws(() => completion({ summary: "Summary", idempotencyKey: "key", ...field }));
  }
  assert.equal(expiry(), 28800);
  for (const value of [29, 86401, NaN, 30.5]) assert.throws(() => expiry(value));
});

test("device selection is deterministic, deduplicated, capped, active and reply capable", () => {
  const devices = Array.from({ length: 60 }, (_, i) => ({
    id: `device_${i}`,
    platform: i % 2 ? "ios" : "macos",
    active: true,
    lastSeenAt: new Date(i * 1000).toISOString(),
  }));
  devices.push(
    { ...devices[0], id: "web", platform: "web" },
    { ...devices[59], id: "inactive", active: false },
    devices[59],
  );
  assert.deepEqual(
    selectDevices(devices),
    Array.from({ length: 50 }, (_, i) => `device_${59 - i}`),
  );
});
