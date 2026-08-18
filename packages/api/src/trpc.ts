import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod/v4";

import type { OpenLedger } from "@openledger-cfo/openledger";
import { db } from "@openledger-cfo/db/client";
import { createOpenLedger } from "@openledger-cfo/openledger";

import { recordCliCommand } from "./cli-log";

/**
 * One connector per process, not per module graph. Next bundles the server
 * components and the route handlers separately, so this module is instantiated
 * twice in one process — and the connector's queues only serialize the `oled`
 * spawns that share an instance. Two instances means two processes on the
 * ledger's own SQLite file, which `oled` reports as a corrupt database on open.
 */
const forLedger = globalThis as unknown as { oledConnector?: OpenLedger };

export const ledger = (forLedger.oledConnector ??= createOpenLedger({
  onCommand: recordCliCommand,
}));

export const createTRPCContext = (opts: { headers: Headers }) => ({
  db,
  ledger,
  headers: opts.headers,
});

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({
    ...shape,
    data: {
      ...shape.data,
      zodError:
        error.cause instanceof ZodError
          ? z.flattenError(error.cause as ZodError<Record<string, unknown>>)
          : null,
    },
  }),
});

export const createTRPCRouter = t.router;

export const publicProcedure = t.procedure;
