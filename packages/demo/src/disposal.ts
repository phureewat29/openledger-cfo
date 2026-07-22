import type { LinkedLeg } from "@openledger-fleet/openledger";

import { fromUnits } from "./money";
import { leg } from "./types";

export interface Disposal {
  /** Where the proceeds land. */
  readonly cash: string;
  /** The account that carries the position's cost. */
  readonly position: string;
  readonly gainAccount: string;
  readonly unit: { position: string; equity: string };
  readonly proceedsUnits: number;
  /** Cost released by this sale, on a weighted average of everything held. */
  readonly basisUnits: number;
  /** The unit leg's own amount, which is the quantity already scaled. */
  readonly quantity: number;
}

/**
 * A sale splits three ways: what came in, what cost left the book, and the
 * difference between them. Gain and loss are the same account read in opposite
 * directions — a loss debits realized gain rather than inventing an expense
 * head — and either way the position is credited the whole basis it released,
 * so nothing of what the holding cost is left behind. The unit leg hands the
 * quantity back, which is what keeps the price recoverable as the ratio of the
 * two sides.
 */
export const disposalLegs = (sale: Disposal): LinkedLeg[] => {
  const unitLeg = leg(sale.unit.equity, sale.unit.position, sale.quantity);
  const gainUnits = sale.proceedsUnits - sale.basisUnits;

  if (gainUnits < 0) {
    return [
      leg(sale.cash, sale.position, fromUnits(sale.proceedsUnits)),
      leg(sale.gainAccount, sale.position, fromUnits(-gainUnits)),
      unitLeg,
    ];
  }

  // Sold at exactly what it cost: a zero leg is not a posting.
  if (gainUnits === 0) {
    return [leg(sale.cash, sale.position, fromUnits(sale.basisUnits)), unitLeg];
  }

  return [
    leg(sale.cash, sale.position, fromUnits(sale.basisUnits)),
    leg(sale.cash, sale.gainAccount, fromUnits(gainUnits)),
    unitLeg,
  ];
};
