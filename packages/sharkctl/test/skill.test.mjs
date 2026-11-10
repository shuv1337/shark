import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SKILL = new URL("../../../skills/shark/SKILL.md", import.meta.url);

test("the skill routes agent decisions to the queue, not board re-login", async () => {
  const skill = await readFile(SKILL, "utf8");
  const section = skill.split("## Post to the queue\n")[1]?.split("\n## ")[0];
  assert.ok(section, "queue routing section missing");
  for (const term of ["queue_post", "queue_wait", "queue_answers", "queue_ack", "source", "claimed", "moved to the queue", ":10002/"]) {
    assert.ok(section.includes(term), `missing ${term}`);
  }
  assert.ok(skill.includes("No `sharkctl` for agent work"));
  assert.ok(!skill.includes("## Post to the Board"));
  assert.ok(!/sharkctl auth login [^`]*--scope board:write/.test(skill));
});
