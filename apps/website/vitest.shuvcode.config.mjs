import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test-integration/shuvcode-arbitration.test.mjs"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
