import { z } from "zod/v4";

import { eq } from "@openledger-fleet/db";
import { budget, UpsertBudgetSchema } from "@openledger-fleet/db/schema";

import { createTRPCRouter, publicProcedure } from "../trpc";

export const budgetsRouter = createTRPCRouter({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.query.budget.findMany({ orderBy: (t, { asc }) => asc(t.category) }),
  ),
  upsert: publicProcedure
    .input(UpsertBudgetSchema)
    .mutation(async ({ ctx, input }) => {
      const monthlyLimit = input.monthlyLimit.toFixed(2);
      await ctx.db
        .insert(budget)
        .values({ category: input.category, monthlyLimit })
        .onConflictDoUpdate({ target: budget.category, set: { monthlyLimit } });
    }),
  remove: publicProcedure
    .input(z.object({ category: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(budget).where(eq(budget.category, input.category));
    }),
});
