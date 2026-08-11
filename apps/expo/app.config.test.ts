import type { ConfigContext } from "expo/config";
import { afterEach, describe, expect, it } from "vitest";
import createConfig from "./app.config";

const SHARK_EAS_PROJECT_ID = "af59c084-62af-40bd-b679-2d05bafa4746";
const originalProjectId = process.env.EAS_PROJECT_ID;
const originalBuildProfile = process.env.EAS_BUILD_PROFILE;

afterEach(() => {
  if (originalProjectId === undefined) delete process.env.EAS_PROJECT_ID;
  else process.env.EAS_PROJECT_ID = originalProjectId;

  if (originalBuildProfile === undefined) delete process.env.EAS_BUILD_PROFILE;
  else process.env.EAS_BUILD_PROFILE = originalBuildProfile;
});

describe("Expo application config", () => {
  it("embeds the operator-owned EAS project ID in local native builds", () => {
    delete process.env.EAS_PROJECT_ID;
    delete process.env.EAS_BUILD_PROFILE;

    const config = createConfig({ config: {} } as ConfigContext);

    expect(config.extra).toMatchObject({ eas: { projectId: SHARK_EAS_PROJECT_ID } });
  });
});
