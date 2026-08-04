import { defineConfig } from "eslint/config";

import { baseConfig } from "@openledger-fleet/eslint-config/base";

export default defineConfig(
  {
    // scripts/ sits outside tsconfig include (rootDir stays src/); the probe
    // script is verified by executing it, not by typed lint.
    ignores: ["dist/**", "scripts/**"],
  },
  baseConfig,
);
