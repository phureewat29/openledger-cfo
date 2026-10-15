import type { SeedContext, SeedRow } from "../types";
import { dayIn, within } from "../calendar";
import { BONUS_SWEEP, STANDING_ORDERS } from "../persona";
import { row } from "../types";

/**
 * The wiring between accounts. Salary lands in one place, so every account that
 * owes money has to be pushed its share before the bills that draw on it fall
 * due — which is why these dates all sit just after the two paydays.
 */
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
