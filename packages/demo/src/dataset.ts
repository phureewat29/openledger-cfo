import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod/v4";

import type { OledError, Result } from "@openledger-cfo/openledger";
import {
  accountCreateInputSchema,
  err,
  ingestRowInputSchema,
  isoDateSchema,
  merchantUpsertInputSchema,
  ok,
} from "@openledger-cfo/openledger";

import { bankSchema } from "./products/banks";
import { cardSchema } from "./products/cards";
import { incomeSourceSchema } from "./products/income";
import { loanSchema } from "./products/loans";
import {
  coinSchema,
  holdingSchema,
  thaiFundSchema,
} from "./products/securities";

/** The authored dataset, committed so that loading it is reproducible without a generator. */
export const LIFE_PATH = resolve(
  import.meta.dirname,
  "..",
  "data",
  "life.json",
);

const dateWindowSchema = z.object({ start: isoDateSchema, end: isoDateSchema });

const lifeConfigSchema = z.object({
  country: z.string(),
  currency: z.string(),
  locale: z.string(),
  userName: z.string(),
});

/** Product-class tallies the coverage checks assert against the dataset's own tables. */
const lifeCountsSchema = z.object({
  banks: z.number(),
  cards: z.number(),
  mortgages: z.number(),
  personalLoans: z.number(),
  stocks: z.number(),
  etfs: z.number(),
  funds: z.number(),
  coins: z.number(),
  /** Instruments carrying a unit ledger, which is two accounts each. */
  units: z.number(),
  incomeSources: z.number(),
  accounts: z.number(),
  merchants: z.number(),
  months: z.number(),
});

const lifeExpectedSchema = z.object({
  rows: z.number(),
  /** `status.counts.transactions` counts legs, so a linked row contributes one per leg. */
  transactions: z.number(),
  thbIncome: z.number(),
  thbExpenses: z.number(),
  usdIncome: z.number(),
  balances: z.record(z.string(), z.number()),
  loanBalances: z.record(z.string(), z.number()),
  cardBalances: z.record(z.string(), z.number()),
  counts: lifeCountsSchema,
});

const lifeProductsSchema = z.object({
  banks: z.array(bankSchema),
  cards: z.array(cardSchema),
  loans: z.array(loanSchema),
  holdings: z.array(holdingSchema),
  funds: z.array(thaiFundSchema),
  coins: z.array(coinSchema),
  incomeSources: z.array(incomeSourceSchema),
});

const lifeMetaSchema = z.object({
  variant: z.number(),
  window: dateWindowSchema,
  config: lifeConfigSchema,
  products: lifeProductsSchema,
  expected: lifeExpectedSchema,
});

/** Months chunk the stream so the loader posts one batch per month and streams naturally. */
const lifeMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Expected a YYYY-MM month key"),
  rows: z.array(ingestRowInputSchema).min(1),
});

export const lifeSchema = z.object({
  meta: lifeMetaSchema,
  accounts: z.array(accountCreateInputSchema).min(1),
  merchants: z.array(merchantUpsertInputSchema).min(1),
  months: z.array(lifeMonthSchema).min(1),
});

export type Life = z.infer<typeof lifeSchema>;

export const allRows = (life: Life): Life["months"][number]["rows"] =>
  life.months.flatMap((month) => month.rows);

export const readLife = async (
  path: string = LIFE_PATH,
): Promise<Result<Life, OledError>> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    return err<OledError>({
      kind: "not_found",
      message: `Could not read ${path}: ${String(cause)}`,
      hint: "Author the dataset first with `pnpm demo:generate`.",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    return err<OledError>({
      kind: "parse_failed",
      message: `${path} is not valid JSON: ${String(cause)}`,
    });
  }

  const validated = lifeSchema.safeParse(parsed);
  if (!validated.success) {
    return err<OledError>({
      kind: "invalid",
      message: `${path} does not match the dataset schema`,
      hint: z.prettifyError(validated.error).slice(0, 2_000),
    });
  }
  return ok(validated.data);
};

/** Compact on purpose: the file is committed and read by machines, never edited by hand. */
export const writeLife = async (
  life: Life,
  path: string = LIFE_PATH,
): Promise<number> => {
  const text = JSON.stringify(life);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
  return Buffer.byteLength(text, "utf8");
};
