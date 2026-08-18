import { defineConfig } from "eslint/config";

import { baseConfig } from "@openledger-cfo/eslint-config/base";
import { reactConfig } from "@openledger-cfo/eslint-config/react";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
  reactConfig,
);
