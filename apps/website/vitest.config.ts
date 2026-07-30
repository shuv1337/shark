import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/server/**/*.test.{ts,tsx}",
      "src/client/**/*.test.{ts,tsx}",
      "src/shared/**/*.test.{ts,tsx}",
    ],
  },
});
