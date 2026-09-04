import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main } from "../src/permissions/cli.mjs";

async function temporaryHome() {
  return mkdtemp(join(tmpdir(), "shark-permissions-cli-"));
}

test("setup all installs every adapter in one command", async () => {
  const home = await temporaryHome();
  const result = await main(["setup", "all"], {
    home,
    entrypoint: "/opt/shark/sharkctl.mjs",
    checkAuthentication: async () => true,
    install: {
      platform: "darwin",
      runCommand: async () => {},
    },
  });
  assert.deepEqual(
    result.installed.map((item) => item.agent),
    ["claude", "codex", "opencode"],
  );
  const doctor = await main(["doctor"], {
    home,
    entrypoint: "/opt/shark/sharkctl.mjs",
    checkAuthentication: async () => true,
  });
  assert.deepEqual(doctor, {
    authenticated: true,
    missingScopes: [],
    installed: { claude: true, codex: true, opencode: { v1: true, v2: true } },
  });
});

test("setup refuses to write configs before SHark authentication", async () => {
  const home = await temporaryHome();
  await assert.rejects(
    main(["setup", "claude"], {
      home,
      entrypoint: "/opt/shark/sharkctl.mjs",
      checkAuthentication: async () => false,
    }),
    /not authenticated/,
  );
});

test("setup all on Linux installs supported hooks and reports the OpenCode skip", async () => {
  const home = await temporaryHome();
  const result = await main(["setup", "all"], {
    home,
    entrypoint: "/opt/shark/sharkctl",
    checkAuthentication: async () => true,
    install: { platform: "linux" },
  });
  assert.deepEqual(
    result.installed.map((item) => item.agent),
    ["claude", "codex"],
  );
  assert.match(result.warnings[0], /Skipped OpenCode/);
});

test("setup rejects authenticated credentials missing bridge scopes", async () => {
  const home = await temporaryHome();
  await assert.rejects(
    main(["setup", "claude"], {
      home,
      entrypoint: "/opt/shark/sharkctl",
      authenticationStatus: async () => ({
        authenticated: true,
        scopes: ["notifications:send"],
        missingScopes: ["interactions:create", "interactions:read"],
      }),
    }),
    /interactions:create, interactions:read/,
  );
});

test("permissions help lists only the public commands", async () => {
  const result = await main(["--help"]);
  assert.match(result.help, /permissions setup/);
  assert.match(result.help, /permissions doctor/);
  assert.doesNotMatch(result.help, /hook|daemon|opencode-v1-event/);
});

test("uninstall all reverses only SHark-owned adapters", async () => {
  const home = await temporaryHome();
  await main(["setup", "all"], {
    home,
    entrypoint: "/opt/shark/sharkctl.mjs",
    checkAuthentication: async () => true,
    install: { platform: "darwin", runCommand: async () => {} },
  });
  const result = await main(["uninstall", "all"], {
    home,
    install: { platform: "darwin", runCommand: async () => {} },
  });
  assert.deepEqual(
    result.uninstalled.map((item) => item.agent),
    ["claude", "codex", "opencode"],
  );
  const doctor = await main(["doctor"], {
    home,
    checkAuthentication: async () => true,
  });
  assert.deepEqual(doctor.installed, { claude: false, codex: false, opencode: { v1: false, v2: false } });
});
