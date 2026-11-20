import { difference, range, sumBy } from "es-toolkit";

import type {
  AccountRow,
  OledError,
  OpenLedger,
  Result,
} from "@openledger-cfo/openledger";
import { ok } from "@openledger-cfo/openledger";

import type { DateWindow } from "./calendar";
import type { Life } from "./dataset";
import type { Check } from "./invariants";
import { POISON_ACCOUNTS } from "./accounts";
import { currencyOf } from "./expected";
import { check } from "./invariants";
import { formatMoney, fromUnits, toUnits } from "./money";

interface VerifyOutput {
  checks: Check[];
  facts: string[];
}

/** Half a satang: every amount is generated whole, so nothing legitimate rounds further. */
const TOLERANCE = 0.005;

const near = (actual: number, target: number): boolean =>
  Math.abs(actual - target) <= TOLERANCE;

const asRange = (window: DateWindow) => ({
  from: window.start,
  to: window.end,
});

/** `thb:asset:bank:kbank` implies `thb:asset` and `thb:asset:bank` exist too. */
const withAncestors = (id: string): string[] => {
  const parts = id.split(":");
  return range(2, parts.length + 1).map((depth) =>
    parts.slice(0, depth).join(":"),
  );
};

/** A month wholly inside the window, so its report is a full month of activity. */
const sampleMonthFor = (window: DateWindow): DateWindow =>
  window.start <= "2025-06-01" && window.end >= "2025-06-30"
    ? { start: "2025-06-01", end: "2025-06-30" }
    : window;

/** Money the persona actually spends, as against the heads that count quantity. */
const MONEY_CURRENCIES = new Set(["THB", "USD"]);

interface UnitLedger {
  readonly code: string;
  readonly ticker: string;
  readonly account: string;
  /** The account holding the position's cost. */
  readonly money: string;
}

const metadataText = (
  account: Life["accounts"][number],
  key: string,
): string => {
  const value = account.metadata?.[key];
  return typeof value === "string" ? value : "";
};

/** Found by the marker the app reads, not by parsing ids. */
const unitLedgersOf = (life: Life): UnitLedger[] =>
  life.accounts
    .filter(
      (account) =>
        account.type === "asset" && account.metadata?.kind === "unit",
    )
    .map((account) => ({
      code: currencyOf(account.id),
      ticker: metadataText(account, "ticker") || account.id,
      account: account.id,
      money: metadataText(account, "unit_of"),
    }));

/** Baht and dollars are never ranked against each other. */
const topPositions = (
  life: Life,
  units: UnitLedger[],
  currency: string,
  count: number,
): string =>
  units
    .map((unit) => ({
      ticker: unit.ticker,
      currency: currencyOf(unit.money),
      quantity: life.meta.expected.balances[unit.account] ?? 0,
      basis: life.meta.expected.balances[unit.money] ?? 0,
    }))
    .filter((position) => position.currency === currency)
    .sort((left, right) => right.basis - left.basis)
    .slice(0, count)
    .map(
      (position) =>
        `${position.ticker} ${formatMoney(position.quantity)} u, basis ${formatMoney(position.basis)}`,
    )
    .join("  ·  ");

const readLedger = async (
  oled: OpenLedger,
  window: DateWindow,
  sampleMonth: DateWindow,
) => {
  const status = await oled.status();
  if (!status.ok) return status;
  const report = await oled.report(asRange(window));
  if (!report.ok) return report;
  const sample = await oled.report(asRange(sampleMonth));
  if (!sample.ok) return sample;
  const accounts = await oled.accounts.list();
  if (!accounts.ok) return accounts;
  const questions = await oled.questions.list();
  if (!questions.ok) return questions;
  const merchants = await oled.merchants.list({ limit: 500 });
  if (!merchants.ok) return merchants;
  const tree = await oled.accounts.tree();
  if (!tree.ok) return tree;

  const postings = new Map<string, number>();
  for (const account of POISON_ACCOUNTS) {
    const listed = await oled.transactions.list({ account });
    if (!listed.ok) return listed;
    postings.set(account, listed.value.summary?.total ?? 0);
  }

  return ok({
    status: status.value,
    report: report.value,
    sample: sample.value,
    accounts: accounts.value.rows,
    questions: questions.value.rows,
    merchants: merchants.value.rows,
    tree: tree.value,
    postings,
  });
};

type Ledger = Extract<
  Awaited<ReturnType<typeof readLedger>>,
  { ok: true }
>["value"];

const balanceIn = (rows: readonly AccountRow[], id: string): number =>
  rows.find((row) => row.id === id)?.balance ?? 0;

const compare = (name: string, actual: number, target: number): Check =>
  check(
    name,
    near(actual, target),
    near(actual, target)
      ? ""
      : `expected ${formatMoney(target)}, ledger has ${formatMoney(actual)}`,
  );

const ledgerChecks = (
  life: Life,
  ledger: Ledger,
  units: UnitLedger[],
): Check[] => {
  const expected = life.meta.expected;
  const { status, report, accounts, tree } = ledger;
  const counts = status.counts;
  const netWorth = status.net_worth;
  const balanceOf = (id: string): number => balanceIn(accounts, id);

  const ledgerIds = accounts.map((row) => row.id);
  const wanted = [
    ...new Set([
      ...life.accounts.flatMap((account) => withAncestors(account.id)),
      ...POISON_ACCOUNTS,
    ]),
  ];
  const missing = difference(wanted, ledgerIds);
  const unexpected = difference(ledgerIds, wanted);

  const ledgerMerchants = new Set(
    ledger.merchants.map((row) => row.canonical_name),
  );
  const missingMerchants = life.merchants.filter(
    (merchant) => !ledgerMerchants.has(merchant.name),
  );

  // A unit head holds no income or expense; in a report it would add a quantity to money.
  const reportedCurrencies = [
    ...new Set([
      ...Object.keys(report.income),
      ...Object.keys(report.expenses),
      ...Object.keys(report.net),
    ]),
  ];
  const leaked = reportedCurrencies.filter(
    (currency) => !MONEY_CURRENCIES.has(currency),
  );

  const unitGaps = units.filter(
    (unit) =>
      !near(
        netWorth?.net_worth[unit.code] ?? 0,
        expected.balances[unit.account] ?? 0,
      ),
  );

  const isLeaf = (row: AccountRow): boolean =>
    !accounts.some((other) => other.parent_id === row.id);
  const negativeAssets = accounts.filter(
    (row) => row.type === "asset" && isLeaf(row) && row.balance < -TOLERANCE,
  );

  const mismatched = accounts.filter(
    (row) => !near(row.balance, expected.balances[row.id] ?? 0),
  );

  // Parents carry no balance of their own; only their rollup is worth asserting.
  const subtreeTotal = (rootId: string): number =>
    fromUnits(
      sumBy(
        Object.entries(expected.balances).filter(
          ([id]) => id === rootId || id.startsWith(`${rootId}:`),
        ),
        ([, balance]) => toUnits(balance),
      ),
    );
  const rollupGaps = tree.rows
    .map((root) => ({
      id: root.id,
      rollup: root.rollup[currencyOf(root.id)] ?? 0,
      leaves: subtreeTotal(root.id),
    }))
    .filter((root) => !near(root.rollup, root.leaves));

  return [
    check(
      "database reachable",
      status.db.reachable && counts !== null,
      status.db.error ?? "",
    ),
    check(
      "transaction count matches the dataset",
      counts?.transactions === expected.transactions,
      `expected ${String(expected.transactions)}, ledger has ${String(counts?.transactions)}`,
    ),
    check(
      "chart of accounts matches",
      missing.length === 0 && unexpected.length === 0,
      [
        missing.length > 0 ? `missing ${missing.join(", ")}` : "",
        unexpected.length > 0 ? `unexpected ${unexpected.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    check(
      "no open questions",
      status.questions?.open === 0 && ledger.questions.length === 0,
      `open=${String(status.questions?.open)}`,
    ),
    check(
      "merchants match the dataset",
      missingMerchants.length === 0 &&
        ledgerMerchants.size === life.merchants.length,
      `dataset ${String(life.merchants.length)}, ledger ${String(ledgerMerchants.size)}${missingMerchants.length > 0 ? `, missing ${missingMerchants.map((m) => m.name).join(", ")}` : ""}`,
    ),
    compare("report THB income", report.income.THB ?? 0, expected.thbIncome),
    compare(
      "report THB expenses",
      report.expenses.THB ?? 0,
      expected.thbExpenses,
    ),
    compare("report USD income", report.income.USD ?? 0, expected.usdIncome),
    check(
      "report THB net is positive",
      (report.net.THB ?? 0) > 0,
      `net ${formatMoney(report.net.THB ?? 0)}`,
    ),
    check(
      "the report counts money only",
      leaked.length === 0,
      leaked.length > 0
        ? `unit heads reached the report: ${leaked.join(", ")}`
        : reportedCurrencies.toSorted().join(", "),
    ),
    check(
      "every unit ledger holds the quantity the dataset says",
      units.length > 0 && unitGaps.length === 0,
      unitGaps
        .slice(0, 3)
        .map(
          (unit) =>
            `${unit.ticker}: ledger ${formatMoney(netWorth?.net_worth[unit.code] ?? 0)} vs dataset ${formatMoney(expected.balances[unit.account] ?? 0)}`,
        )
        .join(" · ") || `${String(units.length)} unit ledgers`,
    ),
    check(
      "THB net worth is positive",
      (netWorth?.net_worth.THB ?? 0) > 0,
      `net worth ${formatMoney(netWorth?.net_worth.THB ?? 0)}`,
    ),
    check(
      "USD net worth is positive",
      (netWorth?.net_worth.USD ?? 0) > 0,
      `net worth ${formatMoney(netWorth?.net_worth.USD ?? 0)}`,
    ),
    ...Object.entries(expected.loanBalances).map(([account, balance]) =>
      compare(`loan balance ${account}`, balanceOf(account), balance),
    ),
    ...Object.entries(expected.cardBalances).map(([account, balance]) =>
      compare(`card balance ${account}`, balanceOf(account), balance),
    ),
    check(
      "no negative asset balances",
      negativeAssets.length === 0,
      negativeAssets
        .map((row) => `${row.id} ${formatMoney(row.balance)}`)
        .join(", "),
    ),
    ...POISON_ACCOUNTS.map((poison) => {
      const postingCount = ledger.postings.get(poison) ?? 0;
      const clean = near(balanceOf(poison), 0) && postingCount === 0;
      return check(
        `${poison} never posted to`,
        clean,
        clean
          ? ""
          : `balance ${formatMoney(balanceOf(poison))}, ${String(postingCount)} postings`,
      );
    }),
    check(
      "every account balance matches the dataset",
      mismatched.length === 0,
      mismatched
        .slice(0, 5)
        .map(
          (row) =>
            `${row.id}: ledger ${formatMoney(row.balance)} vs dataset ${formatMoney(expected.balances[row.id] ?? 0)}`,
        )
        .join(" · "),
    ),
    check(
      "account tree rollups match the dataset",
      rollupGaps.length === 0 && tree.rows.length > 0,
      rollupGaps
        .map(
          (root) =>
            `${root.id}: rollup ${formatMoney(root.rollup)} vs leaves ${formatMoney(root.leaves)}`,
        )
        .join(" · "),
    ),
  ];
};

const ledgerFacts = (
  life: Life,
  ledger: Ledger,
  units: UnitLedger[],
  sampleMonth: DateWindow,
): string[] => {
  const { status, report, sample, tree } = ledger;
  const counts = status.counts;
  const netWorth = status.net_worth;
  return [
    `transactions       ${String(counts?.transactions)}`,
    `accounts           ${String(counts?.accounts)}  (tree roots ${String(tree.summary?.roots)})`,
    `merchants          ${String(counts?.merchants)}`,
    `THB income         ${formatMoney(report.income.THB ?? 0)}`,
    `THB expenses       ${formatMoney(report.expenses.THB ?? 0)}`,
    `THB net            ${formatMoney(report.net.THB ?? 0)}`,
    `USD income         ${formatMoney(report.income.USD ?? 0)}`,
    `THB assets         ${formatMoney(netWorth?.assets.THB ?? 0)}`,
    `THB liabilities    ${formatMoney(netWorth?.liabilities.THB ?? 0)}`,
    `THB net worth      ${formatMoney(netWorth?.net_worth.THB ?? 0)}`,
    `USD net worth      ${formatMoney(netWorth?.net_worth.USD ?? 0)}`,
    ...life.meta.products.loans.map(
      (loan) =>
        `${loan.key.padEnd(18)} ${formatMoney(balanceIn(ledger.accounts, loan.account))}`,
    ),
    `top USD positions  ${topPositions(life, units, "USD", 3)}`,
    `top THB positions  ${topPositions(life, units, "THB", 3)}`,
    `${sampleMonth.start} sample  income ${formatMoney(sample.income.THB ?? 0)}  expenses ${formatMoney(sample.expenses.THB ?? 0)}  net ${formatMoney(sample.net.THB ?? 0)}`,
  ];
};

/** Reads the ledger once, then judges it against the dataset without further I/O. */
export const verifyLedger = async (
  oled: OpenLedger,
  life: Life,
): Promise<Result<VerifyOutput, OledError>> => {
  const sampleMonth = sampleMonthFor(life.meta.window);
  const ledger = await readLedger(oled, life.meta.window, sampleMonth);
  if (!ledger.ok) return ledger;
  const units = unitLedgersOf(life);
  return ok({
    checks: ledgerChecks(life, ledger.value, units),
    facts: ledgerFacts(life, ledger.value, units, sampleMonth),
  });
};
