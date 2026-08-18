import { z } from "zod/v4";

import { eq } from "@openledger-cfo/db";
import { insightState, SetInsightStateSchema } from "@openledger-cfo/db/schema";

import { createTRPCRouter, publicProcedure } from "../trpc";

export const insightsRouter = createTRPCRouter({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.query.insightState.findMany(),
  ),
  set: publicProcedure
    .input(SetInsightStateSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(insightState)
        .values(input)
        .onConflictDoUpdate({
          target: insightState.insightId,
          set: { status: input.status, note: input.note ?? null },
        });
    }),
  clear: publicProcedure
    .input(z.object({ insightId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(insightState)
        .where(eq(insightState.insightId, input.insightId));
    }),
});
