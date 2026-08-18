import { defineConfig } from "eslint/config";

import { baseConfig } from "@openledger-cfo/eslint-config/base";

export default defineConfig({ ignores: ["dist/**"] }, baseConfig);
