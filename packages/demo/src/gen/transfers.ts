import type { SeedContext, SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
import { dayIn, within } from "../calendar";
import { row } from "../rows";

interface StandingOrder {
  day: number;
  from: string;
  to: string;
  amount: number;
  description: string;
}

// Salary lands in one account, so each account that pays bills is pushed its
// share just after the paydays, before those bills fall due.
const STANDING_ORDERS: StandingOrder[] = [
  {
    day: 8,
    from: ACCOUNT.kbank,
    to: ACCOUNT.uob,
    amount: 5_000,
    description: "Standing order — UOB travel account",
  },
  {
    day: 16,
    from: ACCOUNT.kbank,
    to: ACCOUNT.bbl,
    amount: 5_000,
    description: "Standing order — portfolio funding",
  },
  {
    day: 24,
    from: ACCOUNT.kbank,
    to: ACCOUNT.uob,
    amount: 5_000,
    description: "Standing order — UOB travel account",
  },
  {
    day: 26,
    from: ACCOUNT.kbank,
    to: ACCOUNT.scb,
    amount: 100_000,
    description: "Standing order — SCB bill account",
  },
  {
    day: 27,
    from: ACCOUNT.kbank,
    to: ACCOUNT.ktb,
    amount: 30_000,
    description: "Standing order — family support",
  },
  {
    day: 27,
    from: ACCOUNT.kbank,
    to: ACCOUNT.bay,
    amount: 10_000,
    description: "Standing order — emergency fund",
  },
  ...[5, 12, 19, 26].map((day) => ({
    day,
    from: ACCOUNT.kbank,
    to: ACCOUNT.ttbMe,
    amount: 2_500,
    description: "Weekly auto-save — ttb ME Save",
  })),
];

const BONUS_SWEEP = {
  month: 12,
  day: 28,
  from: ACCOUNT.kbank,
  to: ACCOUNT.bay,
  amount: 150_000,
  description: "Bonus sweep — emergency fund",
} as const;

export const generateTransfers = (ctx: SeedContext): SeedRow[] =>
  ctx.months.flatMap((month) => {
    const orders = STANDING_ORDERS.map((order) => ({
      ...order,
      date: dayIn(month, order.day),
    }));
    const sweep = {
      ...BONUS_SWEEP,
      date: dayIn(month, BONUS_SWEEP.day),
    };
    return [...orders, ...(month.month === BONUS_SWEEP.month ? [sweep] : [])]
      .filter((transfer) => within(transfer.date, ctx.window))
      .map((transfer) =>
        row({
          date: transfer.date,
          description: transfer.description,
          debit: transfer.to,
          credit: transfer.from,
          amount: transfer.amount,
        }),
      );
  });
