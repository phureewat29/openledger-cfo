import { groupBy, sortBy } from "es-toolkit";

import type { Life } from "../dataset";
import type { SeedRow } from "../rows";
import { eachMonth, monthKey } from "../calendar";
import { CHART } from "../chart";
import { foldTotals } from "../expected";
import { MERCHANT_UPSERTS } from "../merchants";
import { PERSONA } from "../persona";
import { BANKS } from "../products/banks";
import { CARDS } from "../products/cards";
import { INCOME_SOURCES } from "../products/income";
import { LOANS } from "../products/loans";
import {
  COINS,
  HOLDINGS,
  INSTRUMENTS,
  THAI_FUNDS,
} from "../products/securities";
import { createRng } from "../rng";
import { generateCards } from "./cards";
import { generateCrypto } from "./crypto";
import { generateDaily } from "./daily";
import { generateFunds } from "./funds";
import { generateHousehold } from "./household";
import { generateIncome } from "./income";
import { applyInterest } from "./interest";
import { generateLifestyle } from "./lifestyle";
import { applyLiquidity } from "./liquidity";
import { generateLoans } from "./loans";
import { generateOpening } from "./opening";
import { generateStocks } from "./stocks";
import { generateSubscriptions } from "./subscriptions";
import { generateTransfers } from "./transfers";
import { generateTravel } from "./travel";

const chunkByMonth = (rows: SeedRow[]): Life["months"] =>
  sortBy(
    Object.entries(groupBy(rows, (seedRow) => monthKey(seedRow.date))).map(
      ([month, monthRows]) => ({ month, rows: monthRows }),
    ),
    [(chunk) => chunk.month],
  );

/**
 * Cards, liquidity and interest are passes over the placed rows. The sort is
 * stable, so a refill still precedes the same-day spend it funds.
 */
export const buildLife = (variant: number): Life => {
  const window = PERSONA.window;
  const ctx = { window, months: eachMonth(window), rng: createRng(variant) };

  const loans = generateLoans(ctx);
  const spending: SeedRow[] = [
    ...generateOpening(),
    ...generateIncome(ctx),
    ...generateTransfers(ctx),
    ...loans.rows,
    ...generateFunds(ctx),
    ...generateStocks(ctx),
    ...generateCrypto(ctx),
    ...generateSubscriptions(ctx),
    ...generateHousehold(ctx),
    ...generateLifestyle(ctx),
    ...generateTravel(ctx),
    ...generateDaily(ctx),
  ];

  const cards = generateCards(ctx, spending);
  const settled = sortBy([...spending, ...cards.rows], [(row) => row.date]);
  const rows = applyInterest(ctx, applyLiquidity(settled));
  const months = chunkByMonth(rows);
  const totals = foldTotals(CHART, rows);

  return {
    meta: {
      variant,
      window,
      config: {
        country: PERSONA.country,
        currency: PERSONA.currency,
        locale: PERSONA.locale,
        userName: PERSONA.userName,
      },
      products: {
        banks: BANKS,
        cards: CARDS,
        loans: LOANS,
        holdings: HOLDINGS,
        funds: THAI_FUNDS,
        coins: COINS,
        incomeSources: INCOME_SOURCES,
      },
      expected: {
        rows: totals.rows,
        transactions: totals.transactions,
        thbIncome: totals.income.THB ?? 0,
        thbExpenses: totals.expenses.THB ?? 0,
        usdIncome: totals.income.USD ?? 0,
        balances: totals.balances,
        loanBalances: loans.terminalBalances,
        cardBalances: cards.endBalances,
        counts: {
          banks: BANKS.length,
          cards: CARDS.length,
          mortgages: LOANS.filter((loan) => loan.category === "mortgage")
            .length,
          personalLoans: LOANS.filter((loan) => loan.category === "personal")
            .length,
          stocks: HOLDINGS.filter((holding) => holding.kind === "stock").length,
          etfs: HOLDINGS.filter((holding) => holding.kind === "etf").length,
          funds: THAI_FUNDS.length,
          coins: COINS.length,
          units: INSTRUMENTS.length,
          incomeSources: INCOME_SOURCES.length,
          accounts: CHART.length,
          merchants: MERCHANT_UPSERTS.length,
          months: months.length,
        },
      },
    },
    accounts: CHART,
    merchants: MERCHANT_UPSERTS,
    months,
  };
};
