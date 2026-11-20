import type { SeedRow } from "../rows";
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
import { row } from "../rows";

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

/** Dated the window's first day and generated first, so the stable sort keeps them ahead of that day's rows. */
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
