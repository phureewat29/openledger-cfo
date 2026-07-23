import type { SeedRow } from "../types";
import { ACCOUNT } from "../accounts";
import { CHART } from "../chart";
import {
  OPENING_ASSETS_THB,
  OPENING_ASSETS_USD,
  OPENING_DATE,
} from "../persona";
import { BANKS } from "../products/banks";
import { CARDS } from "../products/cards";
import { LOANS } from "../products/loans";
import { row } from "../types";

const NAME_OF = new Map(CHART.map((account) => [account.id, account.name]));

const label = (account: string): string => NAME_OF.get(account) ?? account;

const openingRow = (
  account: string,
  amount: number,
  equity: string,
  side: "debit" | "credit",
): SeedRow =>
  row({
    date: OPENING_DATE,
    description: `Opening balance — ${label(account)}`,
    debit: side === "debit" ? account : equity,
    credit: side === "debit" ? equity : account,
    amount,
  });

/**
 * Generated first and dated the window's first day so a stable sort keeps them
 * ahead of every other row on that date: the ledger has to know what the persona
 * already owned before it starts spending it.
 */
export const generateOpening = (): SeedRow[] => [
  ...BANKS.map((bank) =>
    openingRow(bank.account, bank.opening, ACCOUNT.openingTHB, "debit"),
  ),
  ...OPENING_ASSETS_THB.map((entry) =>
    openingRow(entry.account, entry.amount, ACCOUNT.openingTHB, "debit"),
  ),
  ...CARDS.map((card) =>
    openingRow(card.account, card.opening, ACCOUNT.openingTHB, "credit"),
  ),
  ...LOANS.map((loan) =>
    openingRow(loan.account, loan.opening, ACCOUNT.openingTHB, "credit"),
  ),
  ...OPENING_ASSETS_USD.map((entry) =>
    openingRow(entry.account, entry.amount, ACCOUNT.openingUSD, "debit"),
  ),
];
