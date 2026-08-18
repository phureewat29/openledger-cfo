import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod/v4";

/**
 * The one encoder for money at rest. The columns are TEXT, not NUMERIC:
 * affinity would strip "19000.00" to 19000. Boundaries widen with Number().
 */
export const money = (amount: number): string => amount.toFixed(2);

const uuidPk = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer({ mode: "timestamp_ms" })
    .$defaultFn(() => new Date())
    .notNull();

// Also the insert default: drizzle falls through to `$onUpdateFn` when no default is set.
const updatedAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$onUpdateFn(() => new Date());

export const budget = sqliteTable("budget", {
  // full oled account id, e.g. "thb:expense:food"
  category: text().primaryKey(),
  monthlyLimit: text().notNull(),
  updatedAt: updatedAt(),
});

export const goal = sqliteTable("goal", {
  id: uuidPk(),
  name: text().notNull(),
  targetAmount: text().notNull(),
  targetDate: text(),
  // oled account id prefix whose balances measure progress
  accountPrefix: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const insightState = sqliteTable("insight_state", {
  insightId: text().primaryKey(),
  status: text({ enum: ["acknowledged", "dismissed"] }).notNull(),
  note: text(),
  updatedAt: updatedAt(),
});

export const reminder = sqliteTable("reminder", {
  id: uuidPk(),
  title: text().notNull(),
  dueDate: text().notNull(),
  monthly: integer({ mode: "boolean" }).default(false).notNull(),
  note: text(),
  doneAt: integer({ mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

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
