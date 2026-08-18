import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { resolveDbPath } from "./path";
import * as schema from "./schema";

/**
 * Next bundles the server-component graph and the route-handler graph as
 * separate module instances, so a plain module-scope handle would exist
 * twice. WAL is for the cross-process case: a demo load or reset writing
 * cfo.db while a running dev server holds it open.
 */
const globals = globalThis as unknown as { __oledDbClient?: Database.Database };

const open = (): Database.Database => {
  const client = new Database(resolveDbPath());
  client.pragma("journal_mode = WAL");
  return client;
};

const client = (globals.__oledDbClient ??= open());

// Named so dependents' declarations import this alias, not the driver's ambient types.
export type ControlPlaneDb = BetterSQLite3Database<typeof schema>;

export const db: ControlPlaneDb = drizzle({
  client,
  schema,
  casing: "snake_case",
});
