// Type-aware async safety lint. Biome stays the main linter; its
// noFloatingPromises/noMisusedPromises are nursery rules without a type checker
// and misfire on awaited calls, so these two rules run through typescript-eslint.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.expo/**", "**/build/**", "**/*.d.ts"],
  },
  {
    files: ["apps/website/**/*.{ts,tsx}", "apps/expo/**/*.{ts,tsx}", "packages/contracts/**/*.ts"],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Config and test files outside every tsconfig still get type info.
          allowDefaultProject: ["apps/expo/app.config.test.ts", "apps/website/vitest.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
);
