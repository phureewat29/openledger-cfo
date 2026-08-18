import { defineConfig } from "eslint/config";

import {
  baseConfig,
  restrictEnvAccess,
} from "@openledger-cfo/eslint-config/base";
import { nextjsConfig } from "@openledger-cfo/eslint-config/nextjs";
import { reactConfig } from "@openledger-cfo/eslint-config/react";

export default defineConfig(
  {
    ignores: [".next/**"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);
