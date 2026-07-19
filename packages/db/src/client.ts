import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "./env";
import * as schema from "./schema";

/**
 * Next bundles the server-component graph and the route-handler graph as
 * separate module instances, so a plain module-scope pool would exist twice.
 */
const globals = globalThis as unknown as { __oledDbClient?: postgres.Sql };

const client = (globals.__oledDbClient ??= postgres(env.POSTGRES_URL));

export const db = drizzle({ client, schema, casing: "snake_case" });

/**
 * Hands the socket back. A long-lived server never needs this, but a batch
 * script does: node keeps the process alive while a connection is open, so a
 * demo load that has finished its work would otherwise hang instead of exiting.
 */
export const closeDb = (): Promise<void> => {
  globals.__oledDbClient = undefined;
  return client.end();
};
