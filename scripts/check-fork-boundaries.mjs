import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const nativePatch = readFileSync(resolve(root, "patches/expo-widgets@57.0.6.patch"), "utf8");
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
