import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_SCOPES } from "../src/cli.mjs";

const SKILL = new URL("../../../skills/shark/SKILL.md", import.meta.url);

test("the skill's board re-login example keeps every default scope", async () => {
  const skill = await readFile(SKILL, "utf8");
  const example = skill.match(/```bash\n(sharkctl auth login [^`]*--scope board:write)\n```/)?.[1];
  assert.ok(example, "board re-login example not found");
  const scopes = [...example.matchAll(/--scope (\S+)/g)].map((match) => match[1]);
  assert.equal(new Set(scopes).size, scopes.length, "duplicate scope in the example");
  const missing = [...DEFAULT_SCOPES, "board:read", "board:write"].filter(
    (scope) => !scopes.includes(scope),
  );
  assert.deepEqual(missing, [], "replacing the defaults with this list would drop these scopes");
});
