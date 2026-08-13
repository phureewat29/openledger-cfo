import { difference, sum, sumBy } from "es-toolkit";

import type {
  AccountCreateInput,
  AccountType,
} from "@openledger-fleet/openledger";

import type { Life } from "./dataset";
import type { Totals } from "./expected";
import type { Card } from "./products/cards";
import type { Loan } from "./products/loans";
import type { Instrument } from "./products/securities";
import type { SeedRow } from "./types";
import { unitAccountsOf } from "./accounts";
import {
  addMonths,
  dayIn,
  eachMonth,
  lastDayIn,
  monthIndexOf,
  monthKey,
  within,
} from "./calendar";
import { allRows } from "./dataset";
import { currencyOf, foldTotals } from "./expected";
import { formatMoney, fromUnits, toUnits } from "./money";
import { priceOn, withinPriceBand } from "./prices";
import { distributionOn, dividendOn } from "./products/securities";
import { legsOf } from "./types";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const check = (name: string, ok: boolean, detail = ""): Check => ({
  name,
  ok,
  detail,
});

const DEBIT_NATURAL = new Set<AccountType>(["asset", "expense"]);

const leafIds = (accounts: AccountCreateInput[]): string[] =>
  accounts
    .filter(
      (account) =>
        !accounts.some((other) => other.id.startsWith(`${account.id}:`)),
    )
    .map((account) => account.id);

const legUnits = (
  rows: SeedRow[],
  side: "debit" | "credit",
  account: string,
): number =>
  sumBy(
    rows.flatMap((seedRow) =>
      legsOf(seedRow).filter((entry) =>
        side === "debit"
          ? entry.debit_account === account
          : entry.credit_account === account,
      ),
    ),
    (entry) => toUnits(entry.amount),
  );

/**
 * Assets and expenses on one side, everything else on the other. Every row is
 * balanced by construction, so this only fails if a leg reached an account whose
 * declared type contradicts the direction money actually moved in.
 */
const equationChecks = (life: Life, totals: Totals): Check[] => {
  const typeOf = new Map(
    life.accounts.map((account) => [account.id, account.type] as const),
  );
  const perCurrency = new Map<string, number>();

  for (const [account, balance] of Object.entries(totals.balances)) {
    const type = typeOf.get(account);
    if (!type) continue;
    const currency = currencyOf(account);
    const signed = DEBIT_NATURAL.has(type)
      ? toUnits(balance)
      : -toUnits(balance);
    perCurrency.set(currency, (perCurrency.get(currency) ?? 0) + signed);
  }

  return [...perCurrency].map(([currency, units]) =>
    check(
      `accounting equation balances (${currency})`,
      units === 0,
      units === 0 ? "" : `off by ${formatMoney(fromUnits(units))}`,
    ),
  );
};

const linkedGroupsCrediting = (rows: SeedRow[], account: string): SeedRow[] =>
  rows.filter(
    (seedRow) =>
      "linked" in seedRow &&
      seedRow.linked.some((entry) => entry.credit_account === account),
  );

const PAYSLIP_MIN_RATE = 0.22;
const PAYSLIP_MAX_RATE = 0.26;

/**
 * A payslip's legs are the whole of gross pay: what the employee sees, what the
 * revenue department takes, what social security takes and what the provident
 * fund keeps. If they do not add back to gross, money was invented.
 */
const payslipCheck = (life: Life, rows: SeedRow[]): Check => {
  const source = life.meta.products.incomeSources.find(
    (entry) => entry.key === "employment",
  );
  if (!source)
    return check("employment payslips reconcile", false, "no source");

  const groups = linkedGroupsCrediting(rows, source.account);
  const faults: string[] = [];

  for (const group of groups) {
    const legs = legsOf(group).filter(
      (entry) => entry.credit_account === source.account,
    );
    const grossUnits = sumBy(legs, (entry) => toUnits(entry.amount));
    const netUnits = sumBy(
      legs.filter((entry) => entry.debit_account === source.settlesTo),
      (entry) => toUnits(entry.amount),
    );
    const taxUnits = sumBy(
      legs.filter((entry) => entry.debit_account === source.taxAccount),
      (entry) => toUnits(entry.amount),
    );

    if (legs.length !== 4)
      faults.push(`${group.date} has ${String(legs.length)} legs`);
    if (netUnits <= 0) faults.push(`${group.date} pays nothing to the bank`);
    const rate = grossUnits === 0 ? 0 : taxUnits / grossUnits;
    if (rate < PAYSLIP_MIN_RATE || rate > PAYSLIP_MAX_RATE) {
      faults.push(`${group.date} withholds ${(rate * 100).toFixed(1)}%`);
    }
  }

  return check(
    "employment payslips reconcile",
    groups.length > 0 && faults.length === 0,
    faults.slice(0, 3).join(" · "),
  );
};

const CONSULTING_RATE = 0.03;

const retainerCheck = (life: Life, rows: SeedRow[]): Check => {
  const source = life.meta.products.incomeSources.find(
    (entry) => entry.key === "consulting",
  );
  if (!source)
    return check("consulting invoices reconcile", false, "no source");

  const groups = linkedGroupsCrediting(rows, source.account);
  const faults: string[] = [];

  for (const group of groups) {
    const legs = legsOf(group).filter(
      (entry) => entry.credit_account === source.account,
    );
    const grossUnits = sumBy(legs, (entry) => toUnits(entry.amount));
    const whtUnits = sumBy(
      legs.filter((entry) => entry.debit_account === source.taxAccount),
      (entry) => toUnits(entry.amount),
    );
    if (legs.length !== 2)
      faults.push(`${group.date} has ${String(legs.length)} legs`);
    if (whtUnits !== Math.round(grossUnits * CONSULTING_RATE)) {
      faults.push(
        `${group.date} withholds ${formatMoney(fromUnits(whtUnits))}`,
      );
    }
  }

  return check(
    "consulting invoices reconcile",
    groups.length > 0 && faults.length === 0,
    faults.slice(0, 3).join(" · "),
  );
};

interface Installment {
  date: string;
  principalUnits: number;
  interestUnits: number;
}

const installmentsOf = (rows: SeedRow[], loan: Loan): Installment[] =>
  rows
    .filter((seedRow) =>
      legsOf(seedRow).some((entry) => entry.debit_account === loan.account),
    )
    .map((seedRow) => ({
      date: seedRow.date,
      principalUnits: sumBy(
        legsOf(seedRow).filter((entry) => entry.debit_account === loan.account),
        (entry) => toUnits(entry.amount),
      ),
      interestUnits: sumBy(
        legsOf(seedRow).filter(
          (entry) => entry.debit_account === loan.interestAccount,
        ),
        (entry) => toUnits(entry.amount),
      ),
    }));

/**
 * Replays each loan against its own contract: on an amortizing loan the interest
 * charged has to be a month of the rate on what was still owed at the time, and
 * the principal is whatever is left of the payment. The replay is driven by the
 * posted rows, so a schedule that skipped, doubled or mis-split an installment
 * cannot agree with it.
 */
const loanCheck = (life: Life, rows: SeedRow[], loan: Loan): Check => {
  const name = `${loan.label} follows its schedule`;
  const installments = installmentsOf(rows, loan);
  const prepaymentUnits = new Set(
    loan.kind === "amortizing"
      ? loan.prepayments.map((entry) => toUnits(entry.amount))
      : [],
  );

  let balanceUnits = toUnits(loan.opening);
  const faults: string[] = [];

  for (const posted of installments) {
    if (posted.principalUnits > balanceUnits) {
      faults.push(`${posted.date} repays more than is owed`);
      break;
    }

    if (loan.kind === "flat") {
      const regular = toUnits(loan.monthlyPrincipal);
      const isFinal = monthKey(posted.date) === loan.finalPaymentMonth;
      const wanted = isFinal ? balanceUnits : Math.min(regular, balanceUnits);
      if (posted.principalUnits !== wanted) {
        faults.push(
          `${posted.date} principal ${formatMoney(fromUnits(posted.principalUnits))}`,
        );
      }
      if (posted.interestUnits !== toUnits(loan.monthlyInterest)) {
        faults.push(`${posted.date} flat interest drifted`);
      }
    }

    if (loan.kind === "amortizing") {
      const isPrepayment =
        posted.interestUnits === 0 &&
        prepaymentUnits.has(posted.principalUnits);
      if (!isPrepayment) {
        const wantedInterest = Math.round(
          (balanceUnits * loan.annualRate) / 12,
        );
        const wantedPrincipal = Math.min(
          toUnits(loan.monthlyPayment) - wantedInterest,
          balanceUnits,
        );
        if (posted.interestUnits !== wantedInterest) {
          faults.push(
            `${posted.date} interest ${formatMoney(fromUnits(posted.interestUnits))} vs ${formatMoney(fromUnits(wantedInterest))}`,
          );
        }
        if (posted.principalUnits !== wantedPrincipal) {
          faults.push(
            `${posted.date} principal ${formatMoney(fromUnits(posted.principalUnits))} vs ${formatMoney(fromUnits(wantedPrincipal))}`,
          );
        }
      }
    }

    balanceUnits -= posted.principalUnits;
  }

  const tracked = toUnits(life.meta.expected.loanBalances[loan.account] ?? -1);
  if (balanceUnits !== tracked) {
    faults.push(
      `ends at ${formatMoney(fromUnits(balanceUnits))} vs tracked ${formatMoney(fromUnits(tracked))}`,
    );
  }

  return check(
    name,
    installments.length > 0 && faults.length === 0,
    faults.slice(0, 3).join(" · ") ||
      `${String(installments.length)} installments, closes at ${formatMoney(fromUnits(balanceUnits))}`,
  );
};

const flatLoanClosesCheck = (life: Life): Check[] =>
  life.meta.products.loans
    .filter((loan) => loan.kind === "flat")
    .map((loan) =>
      check(
        `${loan.label} settles inside the window`,
        (life.meta.expected.loanBalances[loan.account] ?? -1) === 0,
        `balance ${formatMoney(life.meta.expected.loanBalances[loan.account] ?? -1)}`,
      ),
    );

/**
 * Every statement that fell due inside the window has to have been paid — except
 * the newest one on a card that ends mid-cycle — and the closing balance has to
 * be exactly what the charges, the interest and those payments leave behind.
 */
const cardCheck = (life: Life, rows: SeedRow[], card: Card): Check => {
  const dueDates = eachMonth(life.meta.window)
    .map((month) => ({
      close: dayIn(month, card.statementDay),
      due: dayIn(addMonths(month, 1), card.dueDay),
    }))
    .filter(
      (cycle) =>
        cycle.close <= life.meta.window.end &&
        within(cycle.due, life.meta.window),
    );

  const payments = rows.filter((seedRow) =>
    legsOf(seedRow).some(
      (entry) =>
        entry.debit_account === card.account &&
        entry.credit_account === card.payFrom,
    ),
  );

  const expectedPayments =
    card.finalStatementUnpaid && dueDates.length > 0
      ? dueDates.length - 1
      : dueDates.length;

  // The opening balance and every interest posting are credits to the card, so
  // the charge total already carries both.
  const chargedUnits = legUnits(rows, "credit", card.account);
  const paidUnits = legUnits(rows, "debit", card.account);
  const closingUnits = chargedUnits - paidUnits;
  const tracked = toUnits(life.meta.expected.cardBalances[card.account] ?? -1);

  const faults = [
    payments.length === expectedPayments
      ? ""
      : `${String(payments.length)} payments for ${String(expectedPayments)} payable statements`,
    closingUnits === tracked
      ? ""
      : `closes at ${formatMoney(fromUnits(closingUnits))} vs tracked ${formatMoney(fromUnits(tracked))}`,
  ].filter(Boolean);

  return check(
    `${card.label} cycle closes`,
    faults.length === 0,
    faults.join(" · ") ||
      `${String(payments.length)} statements paid, carries ${formatMoney(fromUnits(closingUnits))}`,
  );
};

/**
 * The balance still standing when a statement closes is at least what was
 * carried past the due date, so a month of the annual rate on it is a ceiling
 * the charge can never legitimately clear.
 */
const cardInterestCheck = (life: Life, rows: SeedRow[]): Check => {
  const rateOf = new Map(
    life.meta.products.cards.map(
      (card) => [card.account, card.annualRate] as const,
    ),
  );
  const interestAccounts = new Set(
    life.accounts
      .filter((account) => account.id.endsWith(":interest:credit-card"))
      .map((account) => account.id),
  );
  const outstanding = new Map<string, number>();
  const breaches: string[] = [];

  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      const rate = rateOf.get(entry.credit_account);
      if (interestAccounts.has(entry.debit_account) && rate !== undefined) {
        const carriedUnits = outstanding.get(entry.credit_account) ?? 0;
        const capUnits = Math.round((carriedUnits * rate) / 12) + 1;
        if (units > capUnits) {
          breaches.push(
            `${seedRow.date} ${entry.credit_account} ${formatMoney(fromUnits(units))} > ${formatMoney(fromUnits(capUnits))}`,
          );
        }
      }
      if (rateOf.has(entry.credit_account)) {
        const account = entry.credit_account;
        outstanding.set(account, (outstanding.get(account) ?? 0) + units);
      }
      if (rateOf.has(entry.debit_account)) {
        const account = entry.debit_account;
        outstanding.set(account, (outstanding.get(account) ?? 0) - units);
      }
    }
  }

  return check(
    "card interest stays under the annual-rate ceiling",
    breaches.length === 0,
    breaches.slice(0, 3).join(" · "),
  );
};

const assetIds = (life: Life): Set<string> =>
  new Set(
    life.accounts
      .filter((account) => account.type === "asset")
      .map((account) => account.id),
  );

/**
 * The one that locks the refill ordering: a closing balance can be positive
 * while the account spent the summer overdrawn, so this folds the stream in
 * posting order and stops at the first row that puts an asset below zero.
 */
const solvencyCheck = (life: Life, rows: SeedRow[]): Check => {
  const name = "no asset account ever goes negative";
  const assets = assetIds(life);
  const balances = new Map<string, number>();

  for (const seedRow of rows) {
    const touched = new Set<string>();
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      if (assets.has(entry.debit_account)) {
        const account = entry.debit_account;
        balances.set(account, (balances.get(account) ?? 0) + units);
        touched.add(account);
      }
      if (assets.has(entry.credit_account)) {
        const account = entry.credit_account;
        balances.set(account, (balances.get(account) ?? 0) - units);
        touched.add(account);
      }
    }

    for (const account of touched) {
      const balanceUnits = balances.get(account) ?? 0;
      if (balanceUnits < 0) {
        return check(
          name,
          false,
          `${account} hits ${formatMoney(fromUnits(balanceUnits))} on ${seedRow.date} at "${seedRow.description}"`,
        );
      }
    }
  }

  return check(name, true);
};

/**
 * The guarantee that survives storage. `transactions list` orders by random UUID
 * within a date, so no consumer can recover the order rows were written in and
 * no same-day refill can be proved to precede the spend it funds. Day boundaries
 * are the finest granularity the ledger actually preserves, so the closing
 * balance is what has to hold — and unlike the stream check above, this one is
 * true of the ledger however it chooses to sort.
 */
const dailyCloseCheck = (life: Life, rows: SeedRow[]): Check => {
  const name = "no asset account closes a day below zero";
  const assets = assetIds(life);
  const perDay = new Map<string, Map<string, number>>();

  for (const seedRow of rows) {
    const day = perDay.get(seedRow.date) ?? new Map<string, number>();
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      if (assets.has(entry.debit_account)) {
        day.set(
          entry.debit_account,
          (day.get(entry.debit_account) ?? 0) + units,
        );
      }
      if (assets.has(entry.credit_account)) {
        day.set(
          entry.credit_account,
          (day.get(entry.credit_account) ?? 0) - units,
        );
      }
    }
    perDay.set(seedRow.date, day);
  }

  const balances = new Map<string, number>();
  for (const date of [...perDay.keys()].sort()) {
    for (const [account, delta] of perDay.get(date) ?? []) {
      const closing = (balances.get(account) ?? 0) + delta;
      balances.set(account, closing);
      if (closing < 0) {
        return check(
          name,
          false,
          `${account} closes ${formatMoney(fromUnits(closing))} on ${date}`,
        );
      }
    }
  }

  return check(name, true);
};

/**
 * The fixed obligations are the ones a reader will scroll for, so every whole
 * month has to show both paydays and every loan that had not yet been settled.
 */
const cadenceCheck = (life: Life, rows: SeedRow[]): Check => {
  const income = life.meta.products.incomeSources;
  const seen = new Map<string, Set<string>>();

  const note = (account: string, date: string): void => {
    const months = seen.get(account) ?? new Set<string>();
    months.add(monthKey(date));
    seen.set(account, months);
  };

  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      if (income.some((source) => source.account === entry.credit_account)) {
        note(entry.credit_account, seedRow.date);
      }
      if (
        life.meta.products.loans.some(
          (loan) => loan.account === entry.debit_account,
        )
      ) {
        note(entry.debit_account, seedRow.date);
      }
    }
  }

  const fullMonths = eachMonth(life.meta.window).filter(
    (month) =>
      dayIn(month, 1) >= life.meta.window.start &&
      lastDayIn(month) <= life.meta.window.end,
  );

  const gaps: string[] = [];
  for (const month of fullMonths) {
    const key = monthKey(dayIn(month, 1));
    for (const source of income) {
      if (!seen.get(source.account)?.has(key))
        gaps.push(`${key} ${source.key}`);
    }
    for (const loan of life.meta.products.loans) {
      const settled =
        (life.meta.expected.loanBalances[loan.account] ?? 0) === 0;
      const lastMonth = [...(seen.get(loan.account) ?? [])].sort().at(-1) ?? "";
      if (settled && key > lastMonth) continue;
      if (!seen.get(loan.account)?.has(key)) gaps.push(`${key} ${loan.key}`);
    }
  }

  return check(
    "every full month pays both incomes and every live loan",
    gaps.length === 0,
    gaps.slice(0, 5).join(", "),
  );
};

const cryptoBasisCheck = (life: Life, rows: SeedRow[]): Check => {
  const coins = new Set(life.meta.products.coins.map((coin) => coin.account));
  const basis = new Map<string, number>();
  const faults: string[] = [];

  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      const units = toUnits(entry.amount);
      if (coins.has(entry.debit_account)) {
        const account = entry.debit_account;
        basis.set(account, (basis.get(account) ?? 0) + units);
      }
      if (!coins.has(entry.credit_account)) continue;
      const account = entry.credit_account;
      const held = basis.get(account) ?? 0;
      if (units > held) {
        faults.push(
          `${seedRow.date} ${account} sells more basis than it holds`,
        );
      }
      basis.set(account, held - units);
    }
  }

  return check(
    "crypto disposals never exceed cost basis",
    faults.length === 0,
    faults.slice(0, 3).join(" · "),
  );
};

const FX_RATE_MIN = 33;
const FX_RATE_MAX = 38;

/** A conversion is two legs across two ledgers; only the implied rate can tie them. */
const conversionCheck = (life: Life, rows: SeedRow[]): Check => {
  const thbConversion = life.accounts.find(
    (account) => account.id === "thb:equity:conversion",
  )?.id;
  const usdConversion = life.accounts.find(
    (account) => account.id === "usd:equity:conversion",
  )?.id;
  const faults: string[] = [];
  let seen = 0;

  for (const seedRow of rows) {
    const legs = legsOf(seedRow);
    const thbUnits = sumBy(
      legs.filter((entry) => entry.debit_account === thbConversion),
      (entry) => toUnits(entry.amount),
    );
    const usdUnits = sumBy(
      legs.filter((entry) => entry.credit_account === usdConversion),
      (entry) => toUnits(entry.amount),
    );
    if (thbUnits === 0 || usdUnits === 0) continue;
    seen += 1;
    const rate = thbUnits / usdUnits;
    if (rate < FX_RATE_MIN || rate > FX_RATE_MAX) {
      faults.push(`${seedRow.date} implies ${rate.toFixed(2)}`);
    }
  }

  return check(
    "currency conversions imply a plausible rate",
    seen > 0 && faults.length === 0,
    faults.slice(0, 3).join(" · "),
  );
};

const coverageChecks = (life: Life, rows: SeedRow[]): Check[] => {
  const posted = new Set<string>();
  for (const seedRow of rows) {
    for (const entry of legsOf(seedRow)) {
      posted.add(entry.debit_account);
      posted.add(entry.credit_account);
    }
  }

  const dead = difference(leafIds(life.accounts), [...posted]);
  const counts = life.meta.expected.counts;
  const products = life.meta.products;

  const shortfalls = [
    products.banks.length >= 7 ? "" : "banks",
    products.cards.length >= 4 ? "" : "cards",
    products.loans.filter((loan) => loan.category === "mortgage").length >= 2
      ? ""
      : "mortgages",
    products.loans.filter((loan) => loan.category === "personal").length >= 2
      ? ""
      : "personal loans",
    products.holdings.filter((holding) => holding.kind === "stock").length >= 10
      ? ""
      : "stocks",
    products.funds.length >= 3 ? "" : "funds",
    products.coins.length >= 3 ? "" : "crypto",
    products.incomeSources.length >= 2 ? "" : "income sources",
  ].filter(Boolean);

  const unposted = [
    ...products.banks.map((bank) => bank.account),
    ...products.cards.map((card) => card.account),
    ...products.loans.map((loan) => loan.account),
    ...products.holdings.map((holding) => holding.account),
    ...products.funds.map((fund) => fund.account),
    ...products.coins.map((coin) => coin.account),
    ...products.incomeSources.map((source) => source.account),
  ].filter((account) => !posted.has(account));

  return [
    check(
      "every charted account carries a posting",
      dead.length === 0,
      dead.join(", "),
    ),
    check(
      "product coverage meets the persona",
      shortfalls.length === 0 && unposted.length === 0,
      [
        shortfalls.length > 0 ? `too few ${shortfalls.join(", ")}` : "",
        unposted.length > 0 ? `never posted: ${unposted.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ") ||
        `${String(counts.banks)} banks, ${String(counts.cards)} cards, ${String(counts.mortgages)} mortgages, ${String(counts.personalLoans)} personal loans, ${String(counts.stocks)} stocks, ${String(counts.etfs)} etf, ${String(counts.funds)} funds, ${String(counts.coins)} crypto, ${String(counts.incomeSources)} income sources`,
    ),
  ];
};

/** The dataset states its own totals; folding the rows again is what makes them a claim. */
const totalsCheck = (life: Life, totals: Totals): Check[] => {
  const expected = life.meta.expected;

  const mismatched = Object.entries(totals.balances).filter(
    ([account, balance]) =>
      toUnits(expected.balances[account] ?? 0) !== toUnits(balance),
  );

  return [
    check(
      "rows only touch charted accounts",
      totals.unknownAccounts.length === 0,
      totals.unknownAccounts.join(", "),
    ),
    check(
      "counts and sums match the dataset's own totals",
      totals.rows === expected.rows &&
        totals.transactions === expected.transactions &&
        toUnits(totals.income.THB ?? 0) === toUnits(expected.thbIncome) &&
        toUnits(totals.expenses.THB ?? 0) === toUnits(expected.thbExpenses) &&
        toUnits(totals.income.USD ?? 0) === toUnits(expected.usdIncome) &&
        mismatched.length === 0,
      `${String(totals.rows)} rows, ${String(totals.transactions)} legs${mismatched.length > 0 ? `, ${String(mismatched.length)} balances differ` : ""}`,
    ),
  ];
};

const chunkCheck = (life: Life): Check => {
  const faults: string[] = [];
  let previous = "";

  for (const chunk of life.months) {
    if (chunk.month <= previous) faults.push(`${chunk.month} out of order`);
    previous = chunk.month;
    for (const seedRow of chunk.rows) {
      if (monthKey(seedRow.date) !== chunk.month) {
        faults.push(`${seedRow.date} filed under ${chunk.month}`);
      }
      if (!within(seedRow.date, life.meta.window)) {
        faults.push(`${seedRow.date} outside the window`);
      }
    }
  }

  return check(
    "months are ordered and hold only their own rows",
    faults.length === 0,
    faults.slice(0, 3).join(" · "),
  );
};

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
      // The gain belongs to whichever instrument was sold, and a group naming
      // two of them says nothing about which. Every price it implies would then
      // carry the other one's gain.
      if (unitLegs.size > 1) {
        gainFaults.push(
          `${seedRow.date} "${seedRow.description}" books a realized gain across ${String(unitLegs.size)} instruments`,
        );
      }
    }

    for (const account of new Set([...moneyLegs.keys(), ...unitLegs.keys()])) {
      const money = moneyLegs.get(account) ?? [];
      const quantity = unitLegs.get(account) ?? [];
      // A sale at a loss credits the position twice — what came in and what was
      // left short — so the money side is summed rather than counted. The
      // quantity is one leg or the price it implies belongs to nobody.
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
    faults.slice(0, 3).join(" · ") || `${String(trades.length)} trades priced`,
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
    faults.slice(0, 3).join(" · ") ||
      `${String(positions.size)} unit ledgers replayed`,
  );
};

interface Payer {
  readonly ticker: string;
  readonly account: string;
  readonly position: string;
  /** What the declared rate pays on a quantity held. */
  readonly payout: (quantity: number) => number;
}

const dividendPayers = (life: Life): Payer[] =>
  life.meta.products.holdings.map((holding) => ({
    ticker: holding.ticker,
    account: holding.account,
    position: unitAccountsOf(holding.unit).position,
    payout: (quantity: number) => dividendOn(holding, quantity),
  }));

const distributionPayers = (life: Life): Payer[] =>
  life.meta.products.funds.flatMap((fund) =>
    fund.kind === "dca" && fund.dps > 0
      ? [
          {
            ticker: fund.ticker,
            account: fund.account,
            position: unitAccountsOf(fund.unit).position,
            payout: (quantity: number) => distributionOn(fund, quantity),
          },
        ]
      : [],
  );

/**
 * A payout is a rate on a quantity, and both are in the description. Replaying
 * the quantity from the unit legs and recomputing the payout is what stops a
 * dividend or a distribution from drifting away from the position that earned
 * it — the amount is a consequence of the holding, never a figure of its own.
 */
const payoutCheck = (
  name: string,
  label: string,
  rows: SeedRow[],
  payers: Payer[],
): Check => {
  const positions = new Map(payers.map((payer) => [payer.position, payer]));
  const held = new Map<string, number>();
  const faults: string[] = [];
  let seen = 0;

  for (const seedRow of rows) {
    const payer = payers.find((entry) =>
      seedRow.description.startsWith(`${entry.ticker} ${label}`),
    );
    if (payer !== undefined) {
      seen += 1;
      const quantity = fromUnits(held.get(payer.account) ?? 0);
      const posted = sumBy(legsOf(seedRow), (entry) => toUnits(entry.amount));
      const wanted = toUnits(payer.payout(quantity));
      if (posted !== wanted) {
        faults.push(
          `${seedRow.date} ${payer.ticker} pays ${formatMoney(fromUnits(posted))} on ${formatMoney(quantity)}, not ${formatMoney(fromUnits(wanted))}`,
        );
      }
    }

    for (const entry of legsOf(seedRow)) {
      const bought = positions.get(entry.debit_account);
      if (bought) {
        held.set(
          bought.account,
          (held.get(bought.account) ?? 0) + toUnits(entry.amount),
        );
      }
      const sold = positions.get(entry.credit_account);
      if (!sold) continue;
      held.set(
        sold.account,
        (held.get(sold.account) ?? 0) - toUnits(entry.amount),
      );
    }
  }

  return check(
    name,
    seen > 0 && faults.length === 0,
    faults.slice(0, 3).join(" · ") || `${String(seen)} payouts`,
  );
};

interface MonthNet {
  readonly month: string;
  readonly income: number;
  readonly expenses: number;
  readonly net: number;
  /** A month that lies wholly inside the window, so its total is a whole month's. */
  readonly full: boolean;
}

/**
 * What a reader sees on the dashboard: income and expenses per calendar month,
 * signed the way `oled report` signs them, in the ledger's own currency.
 */
export const monthlyNets = (life: Life): MonthNet[] => {
  const typeOf = new Map(
    life.accounts.map((account) => [account.id, account.type] as const),
  );
  const primary = life.meta.config.currency;

  return life.months.map((chunk) => {
    let incomeUnits = 0;
    let expenseUnits = 0;
    for (const seedRow of chunk.rows) {
      for (const entry of legsOf(seedRow)) {
        const units = toUnits(entry.amount);
        for (const [account, sign] of [
          [entry.debit_account, -1],
          [entry.credit_account, 1],
        ] as const) {
          if (currencyOf(account) !== primary) continue;
          const type = typeOf.get(account);
          if (type === "income") incomeUnits += sign * units;
          if (type === "expense") expenseUnits -= sign * units;
        }
      }
    }
    const first = `${chunk.month}-01`;
    return {
      month: chunk.month,
      income: fromUnits(incomeUnits),
      expenses: fromUnits(expenseUnits),
      net: fromUnits(incomeUnits - expenseUnits),
      full:
        first >= life.meta.window.start &&
        lastDayIn({
          year: Number(chunk.month.slice(0, 4)),
          month: Number(chunk.month.slice(5, 7)),
        }) <= life.meta.window.end,
    };
  });
};

const NET_FLOOR = 100_000;
const NET_COMFORTABLE = 150_000;
const COMFORTABLE_MONTHS = 14;
const DECEMBER_FLOOR = 600_000;
const SAVINGS_RATE_MIN = 0.32;
const SAVINGS_RATE_MAX = 0.48;

/**
 * The shape of the life, not just its arithmetic. A ledger whose thin months
 * read as near-zero describes someone living to the edge of their income, which
 * is not this persona — so the floor, the spread and the December peaks are
 * assertions in their own right.
 */
const netHealthChecks = (life: Life): Check[] => {
  const months = monthlyNets(life);
  const full = months.filter((month) => month.full);
  const thin = full.filter((month) => month.net < NET_FLOOR);
  const comfortable = full.filter((month) => month.net >= NET_COMFORTABLE);
  const decembers = full.filter((month) => month.month.endsWith("-12"));
  const weakDecember = decembers.filter((month) => month.net < DECEMBER_FLOOR);
  const income = sumBy(months, (month) => month.income);
  const rate = income === 0 ? 0 : sumBy(months, (month) => month.net) / income;
  const lowest = [...full].sort((left, right) => left.net - right.net)[0];

  return [
    check(
      "every full month clears the net floor",
      full.length > 0 && thin.length === 0,
      thin.length > 0
        ? thin
            .slice(0, 3)
            .map((month) => `${month.month} nets ${formatMoney(month.net)}`)
            .join(" · ")
        : `lowest ${lowest?.month ?? "—"} at ${formatMoney(lowest?.net ?? 0)}`,
    ),
    check(
      "most full months are comfortable, not merely solvent",
      comfortable.length >= COMFORTABLE_MONTHS,
      `${String(comfortable.length)}/${String(full.length)} months clear ${formatMoney(NET_COMFORTABLE)}`,
    ),
    check(
      "bonus months land as bonus months",
      decembers.length > 0 && weakDecember.length === 0,
      decembers
        .map((month) => `${month.month} ${formatMoney(month.net)}`)
        .join(" · "),
    ),
    check(
      "the window saves a plausible share of what it earns",
      rate >= SAVINGS_RATE_MIN && rate <= SAVINGS_RATE_MAX,
      `${(rate * 100).toFixed(1)}% of ${formatMoney(income)}`,
    ),
  ];
};

/**
 * Assertions about the dataset that hold independently of how it was produced,
 * so a generator and its own tally cannot agree on a wrong answer. Everything
 * here is pure: it needs no ledger to run.
 */
export const checkInvariants = (life: Life): Check[] => {
  const rows = allRows(life);
  const totals = foldTotals(life.accounts, rows);
  const scan = scanTrades(life, rows);
  return [
    ...equationChecks(life, totals),
    check(
      "every trade pairs its money with one unit leg",
      scan.trades.length > 0 && scan.pairingFaults.length === 0,
      scan.pairingFaults.slice(0, 3).join(" · ") ||
        `${String(scan.trades.length)} paired trades`,
    ),
    check(
      "a realized gain or loss names one instrument",
      scan.disposals > 0 && scan.gainFaults.length === 0,
      scan.gainFaults.slice(0, 3).join(" · ") ||
        `${String(scan.disposals)} disposals`,
    ),
    impliedPriceCheck(life, scan.trades),
    unitSolvencyCheck(life, rows),
    payoutCheck(
      "dividends pay the declared rate on the shares held",
      "dividend",
      rows,
      dividendPayers(life),
    ),
    payoutCheck(
      "fund distributions pay the declared rate on the units held",
      "semi-annual distribution",
      rows,
      distributionPayers(life),
    ),
    ...netHealthChecks(life),
    payslipCheck(life, rows),
    retainerCheck(life, rows),
    ...life.meta.products.loans.map((loan) => loanCheck(life, rows, loan)),
    ...flatLoanClosesCheck(life),
    ...life.meta.products.cards.map((card) => cardCheck(life, rows, card)),
    cardInterestCheck(life, rows),
    solvencyCheck(life, rows),
    dailyCloseCheck(life, rows),
    cadenceCheck(life, rows),
    cryptoBasisCheck(life, rows),
    conversionCheck(life, rows),
    ...coverageChecks(life, rows),
    ...totalsCheck(life, totals),
    chunkCheck(life),
  ];
};
