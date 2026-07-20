import { z } from "zod/v4";

import { asc, eq } from "@openledger-fleet/db";
import { CreateReminderSchema, reminder } from "@openledger-fleet/db/schema";

import { createTRPCRouter, publicProcedure } from "../trpc";

export const remindersRouter = createTRPCRouter({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.query.reminder.findMany({ orderBy: asc(reminder.dueDate) }),
  ),
  create: publicProcedure
    .input(CreateReminderSchema)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.insert(reminder).values(input).returning();
      return row;
    }),
  complete: publicProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(reminder)
        .set({ doneAt: new Date() })
        .where(eq(reminder.id, input.id));
    }),
  remove: publicProcedure
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(reminder).where(eq(reminder.id, input.id));
    }),
});
