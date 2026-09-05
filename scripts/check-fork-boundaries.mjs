import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const patchName = readdirSync(resolve(root, "patches")).find(
  (name) => name.startsWith("expo-widgets@") && name.endsWith(".patch"),
);
if (!patchName) {
  throw new Error("Fork boundary violation: expo-widgets patch is missing.");
}
const nativePatch = readFileSync(resolve(root, "patches", patchName), "utf8");
const forbiddenOrigins = ["https://hark.ryan.ceo"];

for (const origin of forbiddenOrigins) {
  if (nativePatch.includes(origin)) {
    throw new Error(`Fork boundary violation: native patch references ${origin}`);
  }
}

if (!nativePatch.includes("https://shark.shuv.dev/api/live-activity-interactions/")) {
  throw new Error("Fork boundary violation: SHark Live Activity response endpoint is missing.");
}

console.log("Fork-owned native endpoints are current.");
