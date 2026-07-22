import { defineConfig } from "eslint/config";

import { baseConfig } from "@openledger-fleet/eslint-config/base";

export default defineConfig({ ignores: ["dist/**"] }, baseConfig);
