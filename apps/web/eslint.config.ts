import { defineConfig } from "eslint/config";

import {
  baseConfig,
  restrictEnvAccess,
} from "@openledger-cfo/eslint-config/base";
import { nextjsConfig } from "@openledger-cfo/eslint-config/nextjs";
import { reactConfig } from "@openledger-cfo/eslint-config/react";

const SLICES = [
  "accounts",
  "chat",
  "config",
  "dashboard",
  "flows",
  "ingest",
  "insights",
  "ledger",
  "plan",
  "shell",
];

const ROUTES_ONLY = {
  group: ["~/app/**"],
  message: "Routes import slices; nothing imports a route's own files.",
};

// The typescript-eslint rule, so these blocks never replace the shared env restriction on the core one.
export default defineConfig(
  {
    ignores: [".next/**"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/app/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [ROUTES_ONLY] },
      ],
    },
  },
  {
    files: ["src/lib/**/*.ts", "src/lib/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            ROUTES_ONLY,
            {
              group: SLICES.map((slice) => `~/${slice}/**`),
              message: "lib serves every slice, so it imports none of them.",
            },
          ],
        },
      ],
    },
  },
);
