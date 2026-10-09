import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  liveActivityEndSchema,
  liveActivityStartSchema,
  liveActivityUpdateSchema,
} from "../src/index.ts";

const schemas = Object.fromEntries(
  Object.entries({
    start: liveActivityStartSchema,
    update: liveActivityUpdateSchema,
    end: liveActivityEndSchema,
  }).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
  ]),
);
const unformatted = `// Generated from packages/contracts. Run pnpm --filter @hark/website exec tsx ../../packages/contracts/scripts/export-activity-contract.mjs.\nexport const activitySchemas = ${JSON.stringify(schemas, null, 2)} as const;\n`;
const content = execFileSync(
  "pnpm",
  ["exec", "biome", "format", "--stdin-file-path=integrations/executor/activity-contract.ts"],
  { input: unformatted, encoding: "utf8", cwd: new URL("../../../", import.meta.url) },
);
const target = new URL("../../../integrations/executor/activity-contract.ts", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== content)
    throw new Error("Executor activity contract is stale");
} else writeFileSync(target, content);
