import { groupBy, mapValues, partition, sum, sumBy, uniq } from "es-toolkit";

import type { Life } from "../dataset";
import type { Instrument } from "../products/securities";
import type { SeedRow } from "../types";
import type { Check } from "./shared";
import { unitAccountsOf } from "../accounts";
import { monthIndexOf } from "../calendar";
import { formatMoney, fromUnits, toUnits } from "../money";
import { priceOn, withinPriceBand } from "../prices";
import { deltasOf, legsOf } from "../types";
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

  const scanRow = (seedRow: SeedRow): TradeScan => {
    const legs = legsOf(seedRow);
    const sides = legs.flatMap((entry) => {
      const units = toUnits(entry.amount);
      return [
        { account: entry.debit_account, units },
        { account: entry.credit_account, units },
      ];
    });
    const moneyLegs = mapValues(
      groupBy(
        sides.filter(({ account }) => byMoney.has(account)),
        ({ account }) => account,
      ),
      (group) => group.map(({ units }) => units),
    );
    const unitLegs = mapValues(
      groupBy(
        sides.filter(({ account }) => byUnit.has(account)),
        ({ account }) => byUnit.get(account)?.instrument.account ?? account,
      ),
      (group) => group.map(({ units }) => units),
    );

    // One account holds both directions: a gain is credited to it and a loss
    // debited to it, so the side is what says which way the sale went.
    const gainCredits = legs.filter((entry) =>
      gainAccounts.has(entry.credit_account),
    );
    const gainDebits = legs.filter((entry) =>
      gainAccounts.has(entry.debit_account),
    );
    const gainUnits =
      sumBy(gainCredits, (entry) => toUnits(entry.amount)) -
      sumBy(gainDebits, (entry) => toUnits(entry.amount));
    const instrumentCount = Object.keys(unitLegs).length;

    // A gain belongs to whichever instrument was sold; naming more than one
    // leaves every implied price carrying the wrong gain.
    const gainFaults =
      gainCredits.length + gainDebits.length > 0 && instrumentCount > 1
        ? [
            `${seedRow.date} "${seedRow.description}" books a realized gain across ${String(instrumentCount)} instruments`,
          ]
        : [];

    // A loss sale credits the position twice, so money is summed, not
    // counted; quantity must still be exactly one leg.
    const [paired, broken] = partition(
      uniq([...Object.keys(moneyLegs), ...Object.keys(unitLegs)]),
      (account) =>
        (moneyLegs[account]?.length ?? 0) > 0 &&
        unitLegs[account]?.length === 1,
    );
    return {
      trades: paired.flatMap((account) => {
        const traded = byMoney.get(account);
        return traded === undefined
          ? []
          : [
              {
                date: seedRow.date,
                instrument: traded.instrument,
                moneyUnits: sum(moneyLegs[account] ?? []) + gainUnits,
                quantity: fromUnits(unitLegs[account]?.[0] ?? 0),
              },
            ];
      }),
      pairingFaults: broken.map(
        (account) =>
          `${seedRow.date} "${seedRow.description}" pairs ${String(moneyLegs[account]?.length ?? 0)} money legs with ${String(unitLegs[account]?.length ?? 0)} unit legs on ${account}`,
      ),
      gainFaults,
      disposals: gainCredits.length + gainDebits.length > 0 ? 1 : 0,
    };
  };

  const scans = rows.map(scanRow);
  return {
    trades: scans.flatMap((scan) => scan.trades),
    pairingFaults: scans.flatMap((scan) => scan.pairingFaults),
    gainFaults: scans.flatMap((scan) => scan.gainFaults),
    disposals: sumBy(scans, (scan) => scan.disposals),
  };
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
  const shortages: string[] = [];
  for (const seedRow of rows) {
    for (const [account, units] of deltasOf(seedRow, positions)) {
      const standing = (balances.get(account) ?? 0) + units;
      balances.set(account, standing);
      if (units < 0 && standing < 0) {
        shortages.push(`${seedRow.date} ${account} goes short`);
      }
    }
  }
  const drifts = [...positions].flatMap((position) => {
    const tracked = toUnits(life.meta.expected.balances[position] ?? -1);
    const replayed = balances.get(position) ?? 0;
    return replayed === tracked
      ? []
      : [
          `${position} holds ${formatMoney(fromUnits(replayed))} against tracked ${formatMoney(fromUnits(tracked))}`,
        ];
  });
  const faults = [...shortages, ...drifts];

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
