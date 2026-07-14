import { defineConfig } from "eslint/config";

import { baseConfig } from "@openledger-fleet/eslint-config/base";
import { reactConfig } from "@openledger-fleet/eslint-config/react";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
  reactConfig,
);
