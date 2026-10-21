import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod/v4";

import type { OpenLedger } from "@openledger-cfo/openledger";
import { db } from "@openledger-cfo/db/client";
import { createOpenLedger } from "@openledger-cfo/openledger";

import { recordCliCommand } from "./cli-log";
import { perProcess } from "./per-process";

/**
 * The connector's queues only serialize the `oled` spawns that share an
 * instance. Two instances means two processes contending for the ledger's
 * SQLite lock: needless ~5s busy waits and exit-8 retries.
 */
export const ledger: OpenLedger = perProcess("oledConnector", () =>
  createOpenLedger({ onCommand: recordCliCommand }),
);

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
