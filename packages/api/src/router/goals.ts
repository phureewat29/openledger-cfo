import { z } from "zod/v4";

import { desc, eq } from "@openledger-cfo/db";
import { CreateGoalSchema, goal, money } from "@openledger-cfo/db/schema";

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
        .values({ ...input, targetAmount: money(input.targetAmount) })
        .returning();
      return row;
    }),
  remove: publicProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(goal).where(eq(goal.id, input.id));
    }),
});
