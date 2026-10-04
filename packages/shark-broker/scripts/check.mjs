import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";

for (const directory of ["src", "bin"]) {
  for (const file of await readdir(directory, { recursive: true })) {
    if (!file.endsWith(".mjs")) continue;
    const result = spawnSync(process.execPath, ["--check", `${directory}/${file}`], {
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
