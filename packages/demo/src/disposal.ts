import type { LinkedLeg } from "@openledger-fleet/openledger";

import { fromUnits } from "./money";
import { leg } from "./types";

interface Disposal {
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
 * A sale splits three ways: proceeds in, basis cost out, and their difference.
 * Gain and loss share one account read in opposite directions (a loss debits it, not an expense head), and the position is always credited its whole basis.
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
