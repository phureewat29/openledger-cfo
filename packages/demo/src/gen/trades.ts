import type { LinkedLeg } from "@openledger-cfo/openledger";

import type { Instrument } from "../products/securities";
import type { SeedContext } from "../rows";
import { unitAccountsOf } from "../accounts";
import { monthIndexOf, within } from "../calendar";
import { fromUnits } from "../money";
import { leg } from "../rows";

/** A sale names the quantity it sells; the day's price decides the proceeds. */
export interface Sale {
  readonly account: string;
  readonly date: string;
  /** Share of the units held on the sale date. */
  readonly unitsFraction: number;
  readonly toAccount: string;
}

/** The price is nowhere in the ledger except as the ratio between these two legs. */
export const acquisitionLegs = (
  instrument: Instrument,
  from: string,
  cost: number,
  quantity: number,
): LinkedLeg[] => {
  const unit = unitAccountsOf(instrument.unit);
  return [
    leg(instrument.account, from, cost),
    leg(unit.position, unit.equity, quantity),
  ];
};

interface Disposal {
  readonly cash: string;
  readonly instrument: Instrument;
  readonly gainAccount: string;
  readonly proceedsUnits: number;
  readonly basisUnits: number;
  /** The unit leg's own amount, already scaled. */
  readonly quantity: number;
}

/** A loss debits the gain account rather than an expense head; the position always gives up its whole basis. */
export const disposalLegs = (sale: Disposal): LinkedLeg[] => {
  const position = sale.instrument.account;
  const unit = unitAccountsOf(sale.instrument.unit);
  const unitLeg = leg(unit.equity, unit.position, sale.quantity);
  const gainUnits = sale.proceedsUnits - sale.basisUnits;

  if (gainUnits < 0) {
    return [
      leg(sale.cash, position, fromUnits(sale.proceedsUnits)),
      leg(sale.gainAccount, position, fromUnits(-gainUnits)),
      unitLeg,
    ];
  }

  // A zero leg is not a posting.
  if (gainUnits === 0) {
    return [leg(sale.cash, position, fromUnits(sale.basisUnits)), unitLeg];
  }

  return [
    leg(sale.cash, position, fromUnits(sale.basisUnits)),
    leg(sale.cash, sale.gainAccount, fromUnits(gainUnits)),
    unitLeg,
  ];
};

interface Release {
  readonly soldUnits: number;
  readonly basisUnits: number;
}

/** Quantity and cost per account in integer units; a sale releases cost at the weighted average held. */
export const createBook = () => {
  const held = new Map<string, number>();
  const basis = new Map<string, number>();

  return {
    heldUnits: (account: string): number => held.get(account) ?? 0,
    acquire: (account: string, quantityUnits: number, costUnits: number) => {
      held.set(account, (held.get(account) ?? 0) + quantityUnits);
      basis.set(account, (basis.get(account) ?? 0) + costUnits);
    },
    release: (account: string, fraction: number): Release | undefined => {
      const heldUnits = held.get(account) ?? 0;
      const soldUnits = Math.round(heldUnits * fraction);
      if (soldUnits <= 0) return undefined;
      const costUnits = basis.get(account) ?? 0;
      const basisUnits = Math.round((costUnits * soldUnits) / heldUnits);
      held.set(account, heldUnits - soldUnits);
      basis.set(account, costUnits - basisUnits);
      return { soldUnits, basisUnits };
    },
  };
};

export const salesIn = <T extends Instrument>(
  sales: readonly Sale[],
  instruments: readonly T[],
  ctx: SeedContext,
  index: number,
): { sale: Sale; instrument: T }[] =>
  sales.flatMap((sale) => {
    if (monthIndexOf(sale.date, ctx.window) !== index) return [];
    if (!within(sale.date, ctx.window)) return [];
    const instrument = instruments.find(
      (entry) => entry.account === sale.account,
    );
    return instrument === undefined ? [] : [{ sale, instrument }];
  });
