import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const evidence = JSON.parse(await readFile(new URL("evidence.json", import.meta.url), "utf8"));
assert.equal(evidence.schemaVersion, 1);
assert.equal(evidence.runtimeVersion, "0.153.4");
assert.equal(evidence.verdict, "blocked");
assert.equal(evidence.checks.length, 29);
assert.equal(new Set(evidence.checks.map((check) => check.id)).size, evidence.checks.length);
for (const check of evidence.checks) {
  assert.ok(check.source, `${check.id} must name its source field`);
  assert.deepEqual(check.observed, check.expected, `${check.id}: ${check.source}`);
}
assert.match(evidence.rawEvidenceSha256, /^[a-f0-9]{64}$/);
assert.equal(evidence.extracts.activeQuestion.method, "item/tool/requestUserInput");
assert.equal(evidence.extracts.activeApproval.method, "item/commandExecution/requestApproval");
console.log(`Verified ${evidence.checks.length} native behavior and blocker assertions.`);
