import { groupBy, mapValues, partition, sum, sumBy, uniq } from "es-toolkit";

import type { Life } from "../dataset";
import type { Instrument } from "../products/securities";
import type { SeedRow } from "../rows";
import type { Check } from "./shared";
import { unitAccountsOf } from "../accounts";
import { monthIndexOf } from "../calendar";
import { formatMoney, fromUnits, toUnits } from "../money";
import { priceOn, withinPriceBand } from "../prices";
import { distributionOn, dividendOn } from "../products/securities";
import { deltasOf, legsOf } from "../rows";
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

/** A trade is one instrument's money beside exactly one unit leg; that pairing is what makes a price recoverable. */
const scanTrades = (
  life: Life,
  traded: Traded[],
  rows: SeedRow[],
): TradeScan => {
  const byMoney = new Map(
    traded.map((entry) => [entry.instrument.account, entry]),
  );
  const byUnit = new Map(traded.map((entry) => [entry.position, entry]));
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

/** The price is written nowhere: it is the ratio between the two legs of a trade. */
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

const unitSolvencyCheck = (
  life: Life,
  traded: Traded[],
  rows: SeedRow[],
): Check => {
  const positions = new Set(traded.map((entry) => entry.position));
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

export const securitiesChecks = (life: Life, rows: SeedRow[]): Check[] => {
  const traded = tradedInstruments(life);
  const scan = scanTrades(life, traded, rows);
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
    unitSolvencyCheck(life, traded, rows),
  ];
};

interface Payer {
  readonly ticker: string;
  readonly position: string;
  /** What the declared rate pays on a quantity held. */
  readonly payout: (quantity: number) => number;
}

export const dividendPayers = (life: Life): Payer[] =>
  life.meta.products.holdings.map((holding) => ({
    ticker: holding.ticker,
    position: unitAccountsOf(holding.unit).position,
    payout: (quantity: number) => dividendOn(holding, quantity),
  }));

export const distributionPayers = (life: Life): Payer[] =>
  life.meta.products.funds.flatMap((fund) =>
    fund.kind === "dca" && fund.dps > 0
      ? [
          {
            ticker: fund.ticker,
            position: unitAccountsOf(fund.unit).position,
            payout: (quantity: number) => distributionOn(fund, quantity),
          },
        ]
      : [],
  );

/** Replays the quantity held from the unit legs and recomputes each payout from the declared rate. */
export const payoutCheck = (
  name: string,
  label: string,
  rows: SeedRow[],
  payers: Payer[],
): Check => {
  const tracked = new Set(payers.map((payer) => payer.position));
  const held = new Map<string, number>();
  const faults: string[] = [];
  let seen = 0;

  for (const seedRow of rows) {
    const payer = payers.find((entry) =>
      seedRow.description.startsWith(`${entry.ticker} ${label}`),
    );
    if (payer !== undefined) {
      seen += 1;
      const quantity = fromUnits(held.get(payer.position) ?? 0);
      const posted = sumBy(legsOf(seedRow), (entry) => toUnits(entry.amount));
      const wanted = toUnits(payer.payout(quantity));
      if (posted !== wanted) {
        faults.push(
          `${seedRow.date} ${payer.ticker} pays ${formatMoney(fromUnits(posted))} on ${formatMoney(quantity)}, not ${formatMoney(fromUnits(wanted))}`,
        );
      }
    }

    for (const [position, units] of deltasOf(seedRow, tracked)) {
      held.set(position, (held.get(position) ?? 0) + units);
    }
  }

  return check(
    name,
    seen > 0 && faults.length === 0,
    detail(faults, `${String(seen)} payouts`),
  );
};

export const cryptoBasisCheck = (life: Life, rows: SeedRow[]): Check => {
  const coins = new Set(life.meta.products.coins.map((coin) => coin.account));
  const basis = new Map<string, number>();
  const faults: string[] = [];

  for (const seedRow of rows) {
    for (const [account, units] of deltasOf(seedRow, coins)) {
      const held = basis.get(account) ?? 0;
      basis.set(account, held + units);
      if (units < 0 && -units > held) {
        faults.push(
          `${seedRow.date} ${account} sells more basis than it holds`,
        );
      }
    }
  }

  return check(
    "crypto disposals never exceed cost basis",
    coins.size > 0 && faults.length === 0,
    detail(faults),
  );
};
