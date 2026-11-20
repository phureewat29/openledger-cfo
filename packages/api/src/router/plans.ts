import { z } from "zod/v4";

import { asc, desc, eq } from "@openledger-cfo/db";
import {
  budget,
  goal,
  insightState,
  money,
  reminder,
} from "@openledger-cfo/db/schema";

import { createTRPCRouter, publicProcedure } from "../trpc";

const byId = z.object({ id: z.uuid() });

const UpsertBudgetSchema = z.object({
  category: z.string().min(1).max(120),
  monthlyLimit: z.number().positive().multipleOf(0.01),
});

const CreateGoalSchema = z.object({
  name: z.string().min(1).max(120),
  targetAmount: z.number().positive(),
  targetDate: z.iso.date().optional(),
  accountPrefix: z.string().min(1).max(120),
});

const SetInsightStateSchema = z.object({
  insightId: z.string().min(1).max(160),
  status: z.enum(insightState.status.enumValues),
  note: z.string().max(2000).optional(),
});

const CreateReminderSchema = z.object({
  title: z.string().min(1).max(160),
  dueDate: z.iso.date(),
  monthly: z.boolean().optional(),
  note: z.string().max(2000).optional(),
});

export const budgetsRouter = createTRPCRouter({
  list: publicProcedure.query(({ ctx }) =>
    ctx.db.query.budget.findMany({ orderBy: asc(budget.category) }),
  ),
  upsert: publicProcedure
    .input(UpsertBudgetSchema)
    .mutation(async ({ ctx, input }) => {
      const monthlyLimit = money(input.monthlyLimit);
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
  remove: publicProcedure.input(byId).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(goal).where(eq(goal.id, input.id));
  }),
});

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
  complete: publicProcedure.input(byId).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(reminder)
      .set({ doneAt: new Date() })
      .where(eq(reminder.id, input.id));
  }),
  remove: publicProcedure.input(byId).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(reminder).where(eq(reminder.id, input.id));
  }),
});
