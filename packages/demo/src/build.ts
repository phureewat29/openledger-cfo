import { groupBy } from "es-toolkit";

import type { Life } from "./dataset";
import type { SeedRow } from "./types";
import { eachMonth, monthKey } from "./calendar";
import { CHART } from "./chart";
import { foldTotals } from "./expected";
import { generateCards } from "./gen/cards";
import { generateCrypto } from "./gen/crypto";
import { generateDaily } from "./gen/daily";
import { generateFunds } from "./gen/funds";
import { generateHousehold } from "./gen/household";
import { generateIncome } from "./gen/income";
import { applyInterest } from "./gen/interest";
import { generateLifestyle } from "./gen/lifestyle";
import { applyLiquidity } from "./gen/liquidity";
import { generateLoans } from "./gen/loans";
import { generateOpening } from "./gen/opening";
import { generateStocks } from "./gen/stocks";
import { generateSubscriptions } from "./gen/subscriptions";
import { generateTransfers } from "./gen/transfers";
import { generateTravel } from "./gen/travel";
import { MERCHANT_UPSERTS } from "./merchants";
import { PERSONA } from "./persona";
import { BANKS } from "./products/banks";
import { CARDS } from "./products/cards";
import { INCOME_SOURCES } from "./products/income";
import { LOANS } from "./products/loans";
import {
  COINS,
  HOLDINGS,
  INSTRUMENTS,
  THAI_FUNDS,
} from "./products/securities";
import { createRng } from "./rng";
import { byDate } from "./types";

const chunkByMonth = (rows: SeedRow[]): Life["months"] =>
  Object.entries(groupBy(rows, (seedRow) => monthKey(seedRow.date)))
    .map(([month, monthRows]) => ({ month, rows: monthRows }))
    .sort((left, right) => (left.month < right.month ? -1 : 1));

/**
 * Cards, liquidity and interest run as passes over the result, not as peers —
 * each needs rows the other generators already placed. The sort runs first
 * and is stable, so a refill can still precede the same-day spend it funds.
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
  const settled = [...spending, ...cards.rows].sort(byDate);
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
