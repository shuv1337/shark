import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkVersions } from "./check-versions.mjs";

function fixture(version, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "shark-versions-"));
  const files = {
    "package.json": JSON.stringify({ name: "hark", version }),
    "apps/website/package.json": JSON.stringify({ name: "@hark/website", version }),
    "apps/expo/package.json": JSON.stringify({ name: "@hark/expo", version }),
    "packages/sharkctl/package.json": JSON.stringify({ name: "sharkctl", version }),
    "integrations/executor/package.json": JSON.stringify({ name: "@shuv/shark", version }),
    "apps/expo/app.config.ts": `export default () => ({\n    name: "SHark",\n    version: "${version}",\n});\n`,
    "apps/macos/project.yml": `targets:\n  SHarkMac:\n    settings:\n      base:\n        MARKETING_VERSION: ${version}\n        CURRENT_PROJECT_VERSION: 7\n`,
    "apps/macos/SHarkMac.xcodeproj/project.pbxproj": `MARKETING_VERSION = ${version};\nMARKETING_VERSION = ${version};\n`,
    "apps/macos/Resources/Info.plist":
      "<key>CFBundleShortVersionString</key>\n\t<string>$(MARKETING_VERSION)</string>\n<key>CFBundleVersion</key>\n\t<string>$(CURRENT_PROJECT_VERSION)</string>\n",
    "packages/shark-broker/src/adapters/codex-rpc.mjs": `clientInfo: { name: "shark_reply_broker", version: "${version}" },\n`,
    "skills/shark/SKILL.md": `---\nname: shark\ndescription: Synthetic.\nmetadata:\n  version: "${version}"\n---\n\nThis is\n  skill version \`${version}\`, reviewed with \`sharkctl\` \`${version}\`.\n`,
    ...overrides,
  };
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  return root;
}

function withFixture(version, overrides, run) {
  const root = fixture(version, overrides);
  try {
    run(checkVersions(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("matching versions pass", () => {
  withFixture("2.3.4", {}, ({ product, problems }) => {
    assert.equal(product, "2.3.4");
    assert.deepEqual(problems, []);
  });
});

test("a drifted package version fails", () => {
  withFixture(
    "2.3.4",
    { "packages/sharkctl/package.json": JSON.stringify({ name: "sharkctl", version: "2.3.3" }) },
    ({ problems }) => {
      assert.deepEqual(problems, [
        "packages/sharkctl/package.json: package.json version is 2.3.3, expected 2.3.4",
      ]);
    },
  );
});

test("a drifted skill frontmatter version fails", () => {
  withFixture(
    "2.3.4",
    {
      "skills/shark/SKILL.md":
        '---\nname: shark\nmetadata:\n  version: "2.3.3"\n---\n\nThis is skill version `2.3.4`, reviewed with `sharkctl` `2.3.4`.\n',
    },
    ({ problems }) => {
      assert.deepEqual(problems, [
        "skills/shark/SKILL.md: skill frontmatter metadata.version is 2.3.3, expected 2.3.4",
      ]);
    },
  );
});

test("only a version key directly under skill metadata counts", () => {
  withFixture(
    "2.3.4",
    {
      "skills/shark/SKILL.md":
        '---\nname: shark\nmetadata:\n  internal:\n    version: "2.3.4"\n  version: "9.9.9"\n---\n\nThis is skill version `2.3.4`, reviewed with `sharkctl` `2.3.4`.\n',
    },
    ({ problems }) => {
      assert.deepEqual(problems, [
        "skills/shark/SKILL.md: skill frontmatter metadata.version is 9.9.9, expected 2.3.4",
      ]);
    },
  );
});

test("a drifted macOS marketing version and a hard-coded plist fail", () => {
  withFixture(
    "2.3.4",
    {
      "apps/macos/SHarkMac.xcodeproj/project.pbxproj":
        "MARKETING_VERSION = 2.3.4;\nMARKETING_VERSION = 1.0.0;\n",
      "apps/macos/Resources/Info.plist":
        "<key>CFBundleShortVersionString</key>\n\t<string>1.0</string>\n<key>CFBundleVersion</key>\n\t<string>1</string>\n",
    },
    ({ problems }) => {
      assert.deepEqual(problems, [
        "apps/macos/SHarkMac.xcodeproj/project.pbxproj: macOS MARKETING_VERSION is 1.0.0, expected 2.3.4",
        "apps/macos/Resources/Info.plist: macOS CFBundleShortVersionString is 1.0, expected $(MARKETING_VERSION)",
        "apps/macos/Resources/Info.plist: macOS CFBundleVersion is 1, expected $(CURRENT_PROJECT_VERSION)",
      ]);
    },
  );
});

test("a missing version declaration fails", () => {
  withFixture(
    "2.3.4",
    { "skills/shark/SKILL.md": "---\nname: shark\n---\n\nNo version here.\n" },
    ({ problems }) => {
      assert.equal(problems.length, 3);
      assert.ok(problems.every((problem) => problem.startsWith("skills/shark/SKILL.md: no ")));
    },
  );
});

test("a drifted iOS app version fails", () => {
  const config = (version) => `export default () => ({\n    version: "${version}",\n});\n`;
  withFixture("2.3.4", { "apps/expo/app.config.ts": config("1.0.0") }, ({ problems }) => {
    assert.deepEqual(problems, [
      "apps/expo/app.config.ts: Expo app version is 1.0.0, expected 2.3.4",
    ]);
  });
});

test("the repository's declared versions agree", () => {
  assert.deepEqual(checkVersions().problems, []);
});
