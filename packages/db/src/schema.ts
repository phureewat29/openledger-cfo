import { pgTable } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const budget = pgTable("budget", (t) => ({
  // full oled account id, e.g. "thb:expense:food"
  category: t.varchar({ length: 120 }).primaryKey().notNull(),
  monthlyLimit: t.numeric({ precision: 12, scale: 2 }).notNull(),
  updatedAt: t
    .timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
}));

export const goal = pgTable("goal", (t) => ({
  id: t.uuid().primaryKey().defaultRandom(),
  name: t.varchar({ length: 120 }).notNull(),
  targetAmount: t.numeric({ precision: 14, scale: 2 }).notNull(),
  targetDate: t.date(),
  // oled account id prefix whose balances measure progress
  accountPrefix: t.varchar({ length: 120 }).notNull(),
  createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: t
    .timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
}));

export const insightState = pgTable("insight_state", (t) => ({
  insightId: t.varchar({ length: 160 }).primaryKey().notNull(),
  status: t.text({ enum: ["acknowledged", "dismissed"] }).notNull(),
  note: t.text(),
  updatedAt: t
    .timestamp({ withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
}));

export const reminder = pgTable("reminder", (t) => ({
  id: t.uuid().primaryKey().defaultRandom(),
  title: t.varchar({ length: 160 }).notNull(),
  dueDate: t.date().notNull(),
  monthly: t.boolean().default(false).notNull(),
  note: t.text(),
  doneAt: t.timestamp({ withTimezone: true }),
  createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
}));

export const CreateGoalSchema = z.object({
  name: z.string().min(1).max(120),
  targetAmount: z.number().positive(),
  targetDate: z.iso.date().optional(),
  accountPrefix: z.string().min(1).max(120),
});

export const UpsertBudgetSchema = z.object({
  category: z.string().min(1).max(120),
  monthlyLimit: z.number().positive().multipleOf(0.01),
});

export const SetInsightStateSchema = z.object({
  insightId: z.string().min(1).max(160),
  status: z.enum(["acknowledged", "dismissed"]),
  note: z.string().max(2000).optional(),
});

export const CreateReminderSchema = z.object({
  title: z.string().min(1).max(160),
  dueDate: z.iso.date(),
  monthly: z.boolean().optional(),
  note: z.string().max(2000).optional(),
});
