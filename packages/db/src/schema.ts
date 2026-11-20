import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

// One row, present only when the AI gateway is configured; a machine setting that demo
// loads and resets leave alone.
export const configuration = sqliteTable("configuration", {
  id: text().primaryKey(),
  aiBaseUrl: text().notNull(),
  aiApiKey: text().notNull(),
  aiModel: text().notNull(),
  aiRedact: integer({ mode: "boolean" }).default(true).notNull(),
  updatedAt: updatedAt(),
});
