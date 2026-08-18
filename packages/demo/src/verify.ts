import { difference, sumBy } from "es-toolkit";

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
  const ids: string[] = [];
  for (let depth = 2; depth <= parts.length; depth += 1) {
    ids.push(parts.slice(0, depth).join(":"));
  }
  return ids;
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
}

/** Account metadata is declared as unknown values, so reading one is a narrowing. */
const metadataText = (
  account: Life["accounts"][number] | undefined,
  key: string,
): string => {
  const value = account?.metadata?.[key];
  return typeof value === "string" ? value : "";
};

/**
 * A unit ledger declares itself on the account rather than through its id, so
 * this reads the same marker the app reads and nothing has to keep a second list
 * of which heads are quantities.
 */
const unitLedgersOf = (life: Life): UnitLedger[] =>
  life.accounts
    .filter(
      (account) =>
        account.type === "asset" && account.metadata?.kind === "unit",
    )
    .map((account) => ({
      code: account.id.slice(0, 3).toUpperCase(),
      ticker: metadataText(account, "ticker") || account.id,
      account: account.id,
    }));

/**
 * The largest positions of one money currency. Baht and dollars are never ranked
 * against each other, so each list is a claim a reader can act on.
 */
const topPositions = (life: Life, currency: string, count: number): string =>
  unitLedgersOf(life)
    .map((unit) => {
      const money = metadataText(
        life.accounts.find((account) => account.id === unit.account),
        "unit_of",
      );
      return {
        ticker: unit.ticker,
        currency: currencyOf(money),
        quantity: life.meta.expected.balances[unit.account] ?? 0,
        basis: life.meta.expected.balances[money] ?? 0,
      };
    })
    .filter((position) => position.currency === currency)
    .sort((left, right) => right.basis - left.basis)
    .slice(0, count)
    .map(
      (position) =>
        `${position.ticker} ${formatMoney(position.quantity)} u, basis ${formatMoney(position.basis)}`,
    )
    .join("  ·  ");

export const verifyLedger = async (
  oled: OpenLedger,
  life: Life,
): Promise<Result<VerifyOutput, OledError>> => {
  const checks: Check[] = [];
  const expected = life.meta.expected;
  const sampleMonth = sampleMonthFor(life.meta.window);

  const record = (name: string, passed: boolean, detail = ""): void => {
    checks.push({ name, ok: passed, detail });
  };

  const compare = (name: string, actual: number, target: number): void =>
    record(
      name,
      near(actual, target),
      near(actual, target)
        ? ""
        : `expected ${formatMoney(target)}, ledger has ${formatMoney(actual)}`,
    );

  const status = await oled.status();
  if (!status.ok) return status;
  const report = await oled.report(asRange(life.meta.window));
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

  const counts = status.value.counts;
  const netWorth = status.value.net_worth;

  const balanceOf = (id: string): number =>
    accounts.value.rows.find((row) => row.id === id)?.balance ?? 0;

  record(
    "database reachable",
    status.value.db.reachable && counts !== null,
    status.value.db.error ?? "",
  );

  record(
    "transaction count matches the dataset",
    counts?.transactions === expected.transactions,
    `expected ${String(expected.transactions)}, ledger has ${String(counts?.transactions)}`,
  );

  const ledgerIds = accounts.value.rows.map((row) => row.id);
  const wanted = [
    ...new Set([
      ...life.accounts.flatMap((account) => withAncestors(account.id)),
      ...POISON_ACCOUNTS,
    ]),
  ];
  const missing = difference(wanted, ledgerIds);
  const unexpected = difference(ledgerIds, wanted);
  record(
    "chart of accounts matches",
    missing.length === 0 && unexpected.length === 0,
    [
      missing.length > 0 ? `missing ${missing.join(", ")}` : "",
      unexpected.length > 0 ? `unexpected ${unexpected.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );

  record(
    "no open questions",
    status.value.questions?.open === 0 && questions.value.rows.length === 0,
    `open=${String(status.value.questions?.open)}`,
  );

  const ledgerMerchants = new Set(
    merchants.value.rows.map((row) => row.canonical_name),
  );
  const missingMerchants = life.merchants.filter(
    (merchant) => !ledgerMerchants.has(merchant.name),
  );
  record(
    "merchants match the dataset",
    missingMerchants.length === 0 &&
      ledgerMerchants.size === life.merchants.length,
    `dataset ${String(life.merchants.length)}, ledger ${String(ledgerMerchants.size)}${missingMerchants.length > 0 ? `, missing ${missingMerchants.map((m) => m.name).join(", ")}` : ""}`,
  );

  compare(
    "report THB income",
    report.value.income.THB ?? 0,
    expected.thbIncome,
  );
  compare(
    "report THB expenses",
    report.value.expenses.THB ?? 0,
    expected.thbExpenses,
  );
  compare(
    "report USD income",
    report.value.income.USD ?? 0,
    expected.usdIncome,
  );
  record(
    "report THB net is positive",
    (report.value.net.THB ?? 0) > 0,
    `net ${formatMoney(report.value.net.THB ?? 0)}`,
  );

  // A unit head holds no income and no expense, so it may never reach a report.
  // If one did, a quantity would be adding itself to a sum of money.
  const reportedCurrencies = [
    ...new Set([
      ...Object.keys(report.value.income),
      ...Object.keys(report.value.expenses),
      ...Object.keys(report.value.net),
    ]),
  ];
  const leaked = reportedCurrencies.filter(
    (currency) => !MONEY_CURRENCIES.has(currency),
  );
  record(
    "the report counts money only",
    leaked.length === 0,
    leaked.length > 0
      ? `unit heads reached the report: ${leaked.join(", ")}`
      : reportedCurrencies.toSorted().join(", "),
  );

  const unitGaps = unitLedgersOf(life).filter(
    (unit) =>
      !near(
        netWorth?.net_worth[unit.code] ?? 0,
        life.meta.expected.balances[unit.account] ?? 0,
      ),
  );
  record(
    "every unit ledger holds the quantity the dataset says",
    unitLedgersOf(life).length > 0 && unitGaps.length === 0,
    unitGaps
      .slice(0, 3)
      .map(
        (unit) =>
          `${unit.ticker}: ledger ${formatMoney(netWorth?.net_worth[unit.code] ?? 0)} vs dataset ${formatMoney(life.meta.expected.balances[unit.account] ?? 0)}`,
      )
      .join(" · ") || `${String(unitLedgersOf(life).length)} unit ledgers`,
  );

  record(
    "THB net worth is positive",
    (netWorth?.net_worth.THB ?? 0) > 0,
    `net worth ${formatMoney(netWorth?.net_worth.THB ?? 0)}`,
  );
  record(
    "USD net worth is positive",
    (netWorth?.net_worth.USD ?? 0) > 0,
    `net worth ${formatMoney(netWorth?.net_worth.USD ?? 0)}`,
  );

  for (const [account, balance] of Object.entries(expected.loanBalances)) {
    compare(`loan balance ${account}`, balanceOf(account), balance);
  }
  for (const [account, balance] of Object.entries(expected.cardBalances)) {
    compare(`card balance ${account}`, balanceOf(account), balance);
  }

  const isLeaf = (row: AccountRow): boolean =>
    !accounts.value.rows.some((other) => other.parent_id === row.id);
  const negativeAssets = accounts.value.rows.filter(
    (row) => row.type === "asset" && isLeaf(row) && row.balance < -TOLERANCE,
  );
  record(
    "no negative asset balances",
    negativeAssets.length === 0,
    negativeAssets
      .map((row) => `${row.id} ${formatMoney(row.balance)}`)
      .join(", "),
  );

  for (const poison of POISON_ACCOUNTS) {
    const postings = await oled.transactions.list({ account: poison });
    if (!postings.ok) return postings;
    const postingCount = postings.value.summary?.total ?? 0;
    const clean = near(balanceOf(poison), 0) && postingCount === 0;
    record(
      `${poison} never posted to`,
      clean,
      clean
        ? ""
        : `balance ${formatMoney(balanceOf(poison))}, ${String(postingCount)} postings`,
    );
  }

  const mismatched = accounts.value.rows.filter(
    (row) => !near(row.balance, expected.balances[row.id] ?? 0),
  );
  record(
    "every account balance matches the dataset",
    mismatched.length === 0,
    mismatched
      .slice(0, 5)
      .map(
        (row) =>
          `${row.id}: ledger ${formatMoney(row.balance)} vs dataset ${formatMoney(expected.balances[row.id] ?? 0)}`,
      )
      .join(" · "),
  );

  // Parents carry no balance of their own, so the only thing worth asserting
  // about them is that their rollup really is the subtree beneath it.
  const subtreeTotal = (rootId: string): number =>
    fromUnits(
      sumBy(
        Object.entries(expected.balances).filter(
          ([id]) => id === rootId || id.startsWith(`${rootId}:`),
        ),
        ([, balance]) => toUnits(balance),
      ),
    );

  const rollupGaps = tree.value.rows
    .map((root) => ({
      id: root.id,
      rollup: root.rollup[currencyOf(root.id)] ?? 0,
      leaves: subtreeTotal(root.id),
    }))
    .filter((root) => !near(root.rollup, root.leaves));

  record(
    "account tree rollups match the dataset",
    rollupGaps.length === 0 && tree.value.rows.length > 0,
    rollupGaps
      .map(
        (root) =>
          `${root.id}: rollup ${formatMoney(root.rollup)} vs leaves ${formatMoney(root.leaves)}`,
      )
      .join(" · "),
  );

  const facts = [
    `transactions       ${String(counts?.transactions)}`,
    `accounts           ${String(counts?.accounts)}  (tree roots ${String(tree.value.summary?.roots)})`,
    `merchants          ${String(counts?.merchants)}`,
    `THB income         ${formatMoney(report.value.income.THB ?? 0)}`,
    `THB expenses       ${formatMoney(report.value.expenses.THB ?? 0)}`,
    `THB net            ${formatMoney(report.value.net.THB ?? 0)}`,
    `USD income         ${formatMoney(report.value.income.USD ?? 0)}`,
    `THB assets         ${formatMoney(netWorth?.assets.THB ?? 0)}`,
    `THB liabilities    ${formatMoney(netWorth?.liabilities.THB ?? 0)}`,
    `THB net worth      ${formatMoney(netWorth?.net_worth.THB ?? 0)}`,
    `USD net worth      ${formatMoney(netWorth?.net_worth.USD ?? 0)}`,
    ...life.meta.products.loans.map(
      (loan) =>
        `${loan.key.padEnd(18)} ${formatMoney(balanceOf(loan.account))}`,
    ),
    `top USD positions  ${topPositions(life, "USD", 3)}`,
    `top THB positions  ${topPositions(life, "THB", 3)}`,
    `${sampleMonth.start} sample  income ${formatMoney(sample.value.income.THB ?? 0)}  expenses ${formatMoney(sample.value.expenses.THB ?? 0)}  net ${formatMoney(sample.value.net.THB ?? 0)}`,
  ];

  return ok({ checks, facts });
};
