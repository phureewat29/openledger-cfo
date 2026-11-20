import { caller } from "@openledger-cfo/api";

import type { Insight, RuleInput } from "~/insights/types";
import type { LedgerWindow } from "~/ledger/load";
import { runInsights } from "~/insights/rules";
import { selectRuleInput } from "~/insights/select";
import { closedLoanIds } from "~/ledger/loans";

interface InsightsView {
  readonly input: RuleInput;
  /** Worst first. */
  readonly insights: readonly Insight[];
}

/** The rule input and its verdicts: the window, plus the histories of loans cleared before it opened. */
export const insightsFrom = async (
  window: LedgerWindow,
): Promise<InsightsView> => {
  const { today, asOf, status, accounts, transactions } = window;
  const histories = await Promise.all(
    closedLoanIds(accounts).map((account) =>
      caller.ledger.transactions.listAll({ account }),
    ),
  );
  const input = selectRuleInput({
    today,
    asOf,
    status,
    accounts,
    transactions,
    closedLoanHistory: histories.flat(),
  });
  return { input, insights: runInsights(input) };
};
