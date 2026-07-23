import type { SeedContext, SeedRow } from "../types";
import { dayIn, within } from "../calendar";
import { BONUS_SWEEP, STANDING_ORDERS } from "../persona";
import { row } from "../types";

/**
 * The wiring between accounts. Salary lands in one place, so every account that
 * owes money has to be pushed its share before the bills that draw on it fall
 * due — which is why these dates all sit just after the two paydays.
 */
export const generateTransfers = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];

  for (const month of ctx.months) {
    for (const order of STANDING_ORDERS) {
      const date = dayIn(month, order.day);
      if (!within(date, ctx.window)) continue;
      rows.push(
        row({
          date,
          description: order.description,
          debit: order.to,
          credit: order.from,
          amount: order.amount,
        }),
      );
    }

    if (month.month !== BONUS_SWEEP.month) continue;
    const sweepDate = dayIn(month, BONUS_SWEEP.day);
    if (!within(sweepDate, ctx.window)) continue;
    rows.push(
      row({
        date: sweepDate,
        description: BONUS_SWEEP.description,
        debit: BONUS_SWEEP.to,
        credit: BONUS_SWEEP.from,
        amount: BONUS_SWEEP.amount,
      }),
    );
  }

  return rows;
};
