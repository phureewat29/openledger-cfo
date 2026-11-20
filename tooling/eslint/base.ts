import * as path from "node:path";
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import turboPlugin from "eslint-plugin-turbo";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const ENV_MESSAGE =
  "Configuration lives in the control plane, not the environment; only OLED_CONFIG is read from it.";

export const restrictEnvAccess = defineConfig({
  files: ["**/*.js", "**/*.ts", "**/*.tsx"],
  rules: {
    "no-restricted-properties": [
      "error",
      { object: "process", property: "env", message: ENV_MESSAGE },
    ],
    "no-restricted-imports": [
      "error",
      { name: "process", importNames: ["env"], message: ENV_MESSAGE },
    ],
  },
});

export const baseConfig = defineConfig(
  // Ignore files not tracked by VCS and any config files
  includeIgnoreFile(path.join(import.meta.dirname, "../../.gitignore")),
  { ignores: ["**/*.config.*"] },
  {
    files: ["**/*.js", "**/*.ts", "**/*.tsx"],
    plugins: {
      import: importPlugin,
      turbo: turboPlugin,
    },
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    rules: {
      "turbo/no-undeclared-env-vars": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-unnecessary-condition": [
        "error",
        {
          allowConstantLoopConditions: true,
        },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
    },
  },
  {
    linterOptions: { reportUnusedDisableDirectives: true },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
