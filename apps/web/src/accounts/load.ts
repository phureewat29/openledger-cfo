import { cache } from "react";

import { caller } from "@openledger-cfo/api";

import type { AccountView } from "~/accounts/account";
import type { AccountRow, BalanceSheet } from "~/ledger/accounts";
import type { LedgerLoad } from "~/ledger/load";
import type { Point } from "~/lib/charts/data";
import { accountViewOf } from "~/accounts/account";
import { recentActivity, unitPositionOf } from "~/accounts/portfolio";
import { accountKindOf, balanceSheetOf } from "~/ledger/accounts";
import { asLedgerLoad, ledgerWindow } from "~/ledger/load";
import { interestAccountFor } from "~/ledger/loans";
import { isoToday } from "~/ledger/period";

interface PortfolioView extends Pick<
  BalanceSheet,
  "netWorthThb" | "liabilities"
> {
  /** Leaves, unit ledgers included: a position's quantity lives only there. */
  readonly accounts: readonly AccountRow[];
  readonly activity: Readonly<Record<string, string | undefined>>;
  readonly sparks: Readonly<Record<string, readonly Point[]>>;
}

export const loadPortfolio = cache((): Promise<LedgerLoad<PortfolioView>> =>
  asLedgerLoad(
    ledgerWindow().then((window) => {
      const { netWorthThb, liabilities } = balanceSheetOf(
        window.status,
        window.leaves,
      );
      return {
        accounts: window.leaves,
        ...recentActivity(window.leaves, window.transactions, window.asOf),
        netWorthThb,
        liabilities,
      };
    }),
  ),
);

/** Null when the ledger holds no account by that id. */
export const loadAccount = cache(
  async (id: string): Promise<AccountView | null> => {
    const accounts = await caller.ledger.accounts.list();
    const row = accounts.rows.find((candidate) => candidate.id === id);
    if (row === undefined) return null;

    const rows = await caller.ledger.transactions.listAll({ account: id });
    const kind = accountKindOf(row);
    const interest =
      kind === "loan" ? interestAccountFor(id, accounts.rows) : undefined;
    const unit =
      kind === "position"
        ? unitPositionOf(row, accounts.rows)?.account
        : undefined;

    return accountViewOf({
      row,
      rows,
      accounts: accounts.rows,
      today: isoToday(),
      interest:
        interest === undefined
          ? undefined
          : {
              account: interest,
              rows: await caller.ledger.transactions.listAll({
                account: interest,
              }),
            },
      units:
        unit === undefined
          ? []
          : await caller.ledger.transactions.listAll({ account: unit }),
    });
  },
);
