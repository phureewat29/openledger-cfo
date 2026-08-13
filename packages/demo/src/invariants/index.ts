import type { Life } from "../dataset";
import type { Check } from "./shared";
import { allRows } from "../dataset";
import { foldTotals } from "../expected";
import { dailyCloseCheck, netHealthChecks, solvencyCheck } from "./balances";
import { cadenceCheck } from "./cadence";
import { cardCheck, cardInterestCheck } from "./cards";
import { conversionCheck } from "./conversion";
import { cryptoBasisCheck } from "./crypto";
import { equationChecks } from "./equation";
import { payslipCheck, retainerCheck } from "./income";
import { flatLoanClosesCheck, loanCheck } from "./loans";
import { distributionPayers, dividendPayers, payoutCheck } from "./payouts";
import { securitiesChecks } from "./securities";
import { chunkCheck, coverageChecks, totalsCheck } from "./structural";

export type { Check } from "./shared";
export { monthlyNets } from "./balances";

/**
 * Assertions about the dataset that hold independently of how it was produced,
 * so a generator and its own tally cannot agree on a wrong answer. Everything
 * here is pure: it needs no ledger to run.
 */
export const checkInvariants = (life: Life): Check[] => {
  const rows = allRows(life);
  const totals = foldTotals(life.accounts, rows);
  return [
    ...equationChecks(life, totals),
    ...securitiesChecks(life, rows),
    payoutCheck(
      "dividends pay the declared rate on the shares held",
      "dividend",
      rows,
      dividendPayers(life),
    ),
    payoutCheck(
      "fund distributions pay the declared rate on the units held",
      "semi-annual distribution",
      rows,
      distributionPayers(life),
    ),
    ...netHealthChecks(life),
    payslipCheck(life, rows),
    retainerCheck(life, rows),
    ...life.meta.products.loans.map((loan) => loanCheck(life, rows, loan)),
    ...flatLoanClosesCheck(life),
    ...life.meta.products.cards.map((card) => cardCheck(life, rows, card)),
    cardInterestCheck(life, rows),
    solvencyCheck(life, rows),
    dailyCloseCheck(life, rows),
    cadenceCheck(life, rows),
    cryptoBasisCheck(life, rows),
    conversionCheck(life, rows),
    ...coverageChecks(life, rows),
    ...totalsCheck(life, totals),
    chunkCheck(life),
  ];
};
