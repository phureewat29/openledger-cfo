import type { Config } from "drizzle-kit";

import { resolveDbPath } from "./src/path";

export default {
  schema: "./src/schema.ts",
  dialect: "sqlite",
  dbCredentials: { url: resolveDbPath() },
  casing: "snake_case",
} satisfies Config;
