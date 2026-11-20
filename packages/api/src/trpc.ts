import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { z, ZodError } from "zod/v4";

import type { OpenLedger } from "@openledger-cfo/openledger";
import { perProcess } from "@openledger-cfo/db";
import { db } from "@openledger-cfo/db/client";
import { createOpenLedger } from "@openledger-cfo/openledger";

import { recordCliCommand } from "./cli-log";

// One connector per process: a second copy of its exec lanes would contend for the ledger lock.
export const ledger: OpenLedger = perProcess("oledConnector", () =>
  createOpenLedger({ onCommand: recordCliCommand }),
);

/** Process-wide singletons only, so a call outlives any request that started it. */
export const createTRPCContext = () => ({ db, ledger });

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
