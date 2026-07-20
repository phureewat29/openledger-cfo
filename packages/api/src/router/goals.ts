import { z } from "zod/v4";

import { desc, eq } from "@openledger-fleet/db";
import { CreateGoalSchema, goal } from "@openledger-fleet/db/schema";

import { createTRPCRouter, publicProcedure } from "../trpc";

export const goalsRouter = createTRPCRouter({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.query.goal.findMany({ orderBy: desc(goal.createdAt) }),
  ),
  create: publicProcedure
    .input(CreateGoalSchema)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(goal)
        .values({ ...input, targetAmount: input.targetAmount.toFixed(2) })
        .returning();
      return row;
    }),
  remove: publicProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(goal).where(eq(goal.id, input.id));
    }),
});
