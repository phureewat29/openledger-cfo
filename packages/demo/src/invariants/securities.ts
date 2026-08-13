import { sum } from "es-toolkit";

import type { Life } from "../dataset";
import type { Instrument } from "../products/securities";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { unitAccountsOf } from "../accounts";
import { monthIndexOf } from "../calendar";
import { formatMoney, fromUnits, toUnits } from "../money";
import { priceOn, withinPriceBand } from "../prices";
import { legsOf } from "../types";
import { check, detail } from "./shared";

const REALIZED_GAIN_SUFFIX = ":investment:realized-gain";

interface Traded {
  readonly instrument: Instrument;
  readonly position: string;
  readonly equity: string;
}

const tradedInstruments = (life: Life): Traded[] =>
  [
    ...life.meta.products.holdings,
    ...life.meta.products.funds,
    ...life.meta.products.coins,
  ].map((instrument) => ({ instrument, ...unitAccountsOf(instrument.unit) }));

/** One instrument's appearance in one transaction group. */
interface Trade {
  readonly date: string;
  readonly instrument: Instrument;
  /** Money the group moved for it: cost on an acquisition, proceeds on a disposal. */
  readonly moneyUnits: number;
  /** The unit leg's own amount, which is the quantity already scaled. */
  readonly quantity: number;
}

interface TradeScan {
  readonly trades: Trade[];
  readonly pairingFaults: string[];
  readonly gainFaults: string[];
  /** Groups carrying a realized gain or loss, which is what a disposal is. */
  readonly disposals: number;
}

/**
 * Splits every row into the instrument trades it contains. A trade is the money
 * a group moved for one instrument beside exactly one unit leg: that pairing is
 * what makes a price recoverable, and a group that breaks it has recorded a
 * quantity nobody can put a value on, or a value nobody can put a quantity on.
 */
const scanTrades = (life: Life, rows: SeedRow[]): TradeScan => {
  const byMoney = new Map(
    tradedInstruments(life).map((entry) => [entry.instrument.account, entry]),
  );
  const byUnit = new Map(
    tradedInstruments(life).map((entry) => [entry.position, entry]),
  );
  const gainAccounts = new Set(
    life.accounts
      .filter((account) => account.id.endsWith(REALIZED_GAIN_SUFFIX))
      .map((account) => account.id),
  );

  const trades: Trade[] = [];
  const pairingFaults: string[] = [];
  const gainFaults: string[] = [];
  let disposals = 0;

  for (const seedRow of rows) {
    const moneyLegs = new Map<string, number[]>();
    const unitLegs = new Map<string, number[]>();
    let gainUnits = 0;
    let gainLegs = 0;

    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      for (const side of [entry.debit_account, entry.credit_account]) {
        const traded = byMoney.get(side);
        if (traded) {
          moneyLegs.set(side, [...(moneyLegs.get(side) ?? []), units]);
        }
        const unit = byUnit.get(side);
        if (unit) {
          const key = unit.instrument.account;
          unitLegs.set(key, [...(unitLegs.get(key) ?? []), units]);
        }
      }
      // One account holds both directions: a gain is credited to it and a loss
      // debited to it, so the side is what says which way the sale went.
      if (gainAccounts.has(entry.credit_account)) {
        gainUnits += units;
        gainLegs += 1;
      }
      if (gainAccounts.has(entry.debit_account)) {
        gainUnits -= units;
        gainLegs += 1;
      }
    }

    if (gainLegs > 0) {
      disposals += 1;
      // A gain belongs to whichever instrument was sold; naming more than one
      // leaves every implied price carrying the wrong gain.
      if (unitLegs.size > 1) {
        gainFaults.push(
          `${seedRow.date} "${seedRow.description}" books a realized gain across ${String(unitLegs.size)} instruments`,
        );
      }
    }

    for (const account of new Set([...moneyLegs.keys(), ...unitLegs.keys()])) {
      const money = moneyLegs.get(account) ?? [];
      const quantity = unitLegs.get(account) ?? [];
      // A loss sale credits the position twice, so money is summed, not
      // counted; quantity must still be exactly one leg.
      if (money.length === 0 || quantity.length !== 1) {
        pairingFaults.push(
          `${seedRow.date} "${seedRow.description}" pairs ${String(money.length)} money legs with ${String(quantity.length)} unit legs on ${account}`,
        );
        continue;
      }
      const traded = byMoney.get(account);
      if (traded === undefined) continue;
      trades.push({
        date: seedRow.date,
        instrument: traded.instrument,
        moneyUnits: sum(money) + gainUnits,
        quantity: fromUnits(quantity[0] ?? 0),
      });
    }
  }

  return { trades, pairingFaults, gainFaults, disposals };
};

/**
 * The price is not written down anywhere: it is the ratio between the two legs
 * of a trade. Recomputing it from the posted amounts and holding it against the
 * curve is what proves the ledger and the price table describe one world.
 */
const impliedPriceCheck = (life: Life, trades: Trade[]): Check => {
  const faults: string[] = [];

  for (const trade of trades) {
    const quantity = trade.quantity / trade.instrument.unitScale;
    if (quantity <= 0) {
      faults.push(`${trade.date} ${trade.instrument.ticker} moved no units`);
      continue;
    }
    const implied = fromUnits(trade.moneyUnits) / quantity;
    const target = priceOn(
      trade.instrument,
      monthIndexOf(trade.date, life.meta.window),
    );
    if (withinPriceBand(implied, target)) continue;
    faults.push(
      `${trade.date} ${trade.instrument.ticker} implies ${formatMoney(implied)} against ${formatMoney(target)}`,
    );
  }

  return check(
    "every trade implies a price inside the band",
    trades.length > 0 && faults.length === 0,
    detail(faults, `${String(trades.length)} trades priced`),
  );
};

/**
 * Quantity is double entry in its own right, so a unit position obeys the same
 * law money does: it can never go short, and where it ends has to be what the
 * dataset says it holds.
 */
const unitSolvencyCheck = (life: Life, rows: SeedRow[]): Check => {
  const positions = new Set(
    tradedInstruments(life).map((entry) => entry.position),
  );
  const balances = new Map<string, number>();
  const faults: string[] = [];

  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      if (positions.has(entry.debit_account)) {
        const account = entry.debit_account;
        balances.set(account, (balances.get(account) ?? 0) + units);
      }
      if (!positions.has(entry.credit_account)) continue;
      const account = entry.credit_account;
      const standing = (balances.get(account) ?? 0) - units;
      balances.set(account, standing);
      if (standing < 0) {
        faults.push(`${seedRow.date} ${account} goes short`);
      }
    }
  }

  for (const position of positions) {
    const tracked = toUnits(life.meta.expected.balances[position] ?? -1);
    const replayed = balances.get(position) ?? 0;
    if (replayed === tracked) continue;
    faults.push(
      `${position} holds ${formatMoney(fromUnits(replayed))} against tracked ${formatMoney(fromUnits(tracked))}`,
    );
  }

  return check(
    "unit positions stay solvent and close where the dataset says",
    positions.size > 0 && faults.length === 0,
    detail(faults, `${String(positions.size)} unit ledgers replayed`),
  );
};

/** The four trade-derived checks, sharing one scan of the rows. */
export const securitiesChecks = (life: Life, rows: SeedRow[]): Check[] => {
  const scan = scanTrades(life, rows);
  return [
    check(
      "every trade pairs its money with one unit leg",
      scan.trades.length > 0 && scan.pairingFaults.length === 0,
      detail(scan.pairingFaults, `${String(scan.trades.length)} paired trades`),
    ),
    check(
      "a realized gain or loss names one instrument",
      scan.disposals > 0 && scan.gainFaults.length === 0,
      detail(scan.gainFaults, `${String(scan.disposals)} disposals`),
    ),
    impliedPriceCheck(life, scan.trades),
    unitSolvencyCheck(life, rows),
  ];
};
