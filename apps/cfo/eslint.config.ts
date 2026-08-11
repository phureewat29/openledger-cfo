import { defineConfig } from "eslint/config";

import {
  baseConfig,
  restrictEnvAccess,
} from "@openledger-fleet/eslint-config/base";
import { nextjsConfig } from "@openledger-fleet/eslint-config/nextjs";
import { reactConfig } from "@openledger-fleet/eslint-config/react";

export default defineConfig(
  {
    ignores: [".next/**"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);
