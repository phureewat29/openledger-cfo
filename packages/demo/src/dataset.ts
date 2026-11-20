import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { attempt, attemptAsync } from "es-toolkit";
import { z } from "zod/v4";

import type { OledError, Result } from "@openledger-cfo/openledger";
import {
  accountCreateInputSchema,
  andThen,
  err,
  ingestRowInputSchema,
  isoDateSchema,
  merchantUpsertInputSchema,
  messageOf,
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

/** The four facts `oled config --init` needs; the dataset and the persona both satisfy it. */
export type LedgerConfig = z.infer<typeof lifeConfigSchema>;

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

const readText = async (): Promise<Result<string, OledError>> => {
  const [cause, text] = await attemptAsync(() => readFile(LIFE_PATH, "utf8"));
  return text === null
    ? err<OledError>({
        kind: "not_found",
        message: `Could not read ${LIFE_PATH}: ${messageOf(cause)}`,
        hint: "Author the dataset first with `pnpm demo:generate`.",
      })
    : ok(text);
};

const parseJson = (text: string): Result<unknown, OledError> => {
  const [cause, parsed] = attempt(() => JSON.parse(text) as unknown);
  return cause === null
    ? ok(parsed)
    : err<OledError>({
        kind: "parse_failed",
        message: `${LIFE_PATH} is not valid JSON: ${messageOf(cause)}`,
      });
};

const validate = (parsed: unknown): Result<Life, OledError> => {
  const validated = lifeSchema.safeParse(parsed);
  return validated.success
    ? ok(validated.data)
    : err<OledError>({
        kind: "invalid",
        message: `${LIFE_PATH} does not match the dataset schema`,
        hint: z.prettifyError(validated.error).slice(0, 2_000),
      });
};

export const readLife = async (): Promise<Result<Life, OledError>> =>
  andThen(andThen(await readText(), parseJson), validate);

/** Compact on purpose: the file is committed and read by machines, never edited by hand. */
export const writeLife = async (life: Life): Promise<number> => {
  const text = JSON.stringify(life);
  await mkdir(dirname(LIFE_PATH), { recursive: true });
  await writeFile(LIFE_PATH, text, "utf8");
  return Buffer.byteLength(text, "utf8");
};
