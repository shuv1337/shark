#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// App Store Connect rejects a CFBundleShortVersionString lower than one already uploaded for the
// bundle. The iOS app has a store-distribution EAS build at 1.0.0, so its marketing version may stay
// there until the product version catches up; remove the entry once they match.
export const HELD_VERSIONS = {
  "apps/expo/app.config.ts": "1.0.0",
};

const PACKAGE_DIRECTORIES = ["apps", "packages", "integrations"];

function matchAll(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function sources(root) {
  const packageFiles = ["package.json"];
  for (const directory of PACKAGE_DIRECTORIES) {
    const parent = join(root, directory);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const file = join(directory, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(join(root, file))) packageFiles.push(file);
    }
  }

  return [
    ...packageFiles.map((file) => ({
      file,
      label: "package.json version",
      read: (text) => [JSON.parse(text).version],
    })),
    {
      file: "apps/expo/app.config.ts",
      label: "Expo app version",
      read: (text) => matchAll(text, /^\s*version:\s*"([^"]+)"/gm),
    },
    {
      file: "apps/macos/project.yml",
      label: "macOS MARKETING_VERSION",
      read: (text) => matchAll(text, /^\s*MARKETING_VERSION:\s*"?([^"\s]+)"?\s*$/gm),
    },
    {
      file: "apps/macos/SHarkMac.xcodeproj/project.pbxproj",
      label: "macOS MARKETING_VERSION",
      read: (text) => matchAll(text, /MARKETING_VERSION = "?([^";]+)"?;/g),
    },
    {
      file: "apps/macos/Resources/Info.plist",
      label: "macOS CFBundleShortVersionString",
      expect: "$(MARKETING_VERSION)",
      read: (text) =>
        matchAll(text, /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/g),
    },
    {
      file: "packages/shark-broker/src/adapters/codex-rpc.mjs",
      label: "sharkd clientInfo version",
      read: (text) => matchAll(text, /name: "shark_reply_broker", version: "([^"]+)"/g),
    },
    {
      file: "skills/shark/SKILL.md",
      label: "skill frontmatter metadata.version",
      read: (text) => {
        const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
        return matchAll(
          frontmatter,
          /^metadata:\n(?:[ \t]+.*\n)*?[ \t]+version:\s*"?([^"\s]+)"?/gm,
        );
      },
    },
    {
      file: "skills/shark/SKILL.md",
      label: "skill text version",
      read: (text) => matchAll(text, /skill version `([^`]+)`/g),
    },
    {
      file: "skills/shark/SKILL.md",
      label: "skill reviewed sharkctl version",
      read: (text) => matchAll(text, /reviewed with `sharkctl` `([^`]+)`/g),
    },
  ];
}

export function checkVersions(root = REPO_ROOT) {
  const product = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const problems = [];
  const notes = [];

  for (const source of sources(root)) {
    const path = join(root, source.file);
    if (!existsSync(path)) {
      problems.push(`${source.file}: missing (${source.label})`);
      continue;
    }
    const found = source.read(readFileSync(path, "utf8"));
    if (found.length === 0) {
      problems.push(`${source.file}: no ${source.label} found`);
      continue;
    }
    const expected = source.expect ?? product;
    const held = HELD_VERSIONS[source.file];
    for (const version of found) {
      if (version === expected) continue;
      if (held && version === held) {
        notes.push(`${source.file}: ${source.label} held at ${held} (product ${product})`);
        continue;
      }
      problems.push(`${source.file}: ${source.label} is ${version}, expected ${expected}`);
    }
  }

  return { product, problems, notes };
}

if (process.argv[1] && relative(process.argv[1], fileURLToPath(import.meta.url)) === "") {
  const { product, problems, notes } = checkVersions();
  for (const note of notes) console.log(`note: ${note}`);
  if (problems.length > 0) {
    console.error(`Version drift from product version ${product}:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`All declared versions match product version ${product}.`);
}
