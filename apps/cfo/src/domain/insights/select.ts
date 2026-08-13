import { groupBy, orderBy, sumBy } from "es-toolkit";

import type { RouterOutputs } from "@openledger-fleet/api";

import type { AccountRow } from "../accounts";
import type { Posting, TransactionRow } from "../postings";
import type {
  AccountSummary,
  CategoryWindow,
  ClosedLoan,
  FxPosition,
  MonthTotals,
  MortgageProgress,
  RecurringLine,
  RuleInput,
  SpendLine,
  Subscriptions,
} from "./types";
import { LIQUID_GROUPS, PRIMARY } from "../accounts";
import { accountLabel } from "../format";
import { interestAccountFor, interestPaidFor } from "../loans";
import {
  clampDay,
  dayOf,
  daysInMonth,
  monthOf,
  MONTHS_PER_YEAR,
  monthsBefore,
  monthsUntil,
  windowOf,
} from "../period";
import {
  average,
  inMonth,
  median,
  segmentOf,
  toPostings,
  total,
  upToDay,
} from "../postings";

type LedgerStatus = RouterOutputs["ledger"]["status"];

interface LedgerSnapshot {
  /** Wall clock, for deadlines and anything the reader experiences as "now". */
  readonly today: string;
  /**
   * The date the ledger's own story ends — `today` for a ledger kept current,
   * earlier for one that is not. Every trailing window is measured from here,
   * so a ledger last touched months ago still reports its final real month
   * instead of a page of zeroes.
   */
  readonly asOf: string;
  readonly status: LedgerStatus;
  readonly accounts: readonly AccountRow[];
  /** A trailing window wide enough for month-over-month and 12-month figures. */
  readonly transactions: readonly TransactionRow[];
  /** Full history for loans already paid off, which predate the window. */
  readonly closedLoanHistory: readonly TransactionRow[];
}

const TRAILING_MONTHS = 6;
const TOP_LINES = 3;
const DISCRETIONARY_LIMIT = 8;
const SUBSCRIPTION_HISTORY = 5;

/** Groups nobody can decide their way out of in a single month. */
const COMMITTED = new Set([
  "donation",
  "family",
  "fees",
  "health",
  "housing",
  "insurance",
  "interest",
  "tax",
  "utilities",
]);

const toSpendLine = (posting: Posting): SpendLine => ({
  date: posting.date,
  account: posting.account,
  category: posting.category,
  label: posting.label,
  merchant: posting.merchant,
  amount: posting.amount,
});

const toSummary = (row: AccountRow): AccountSummary => ({
  id: row.id,
  name: row.name,
  kind: row.type,
  currency: row.currency,
  balance: row.balance,
  debitsPosted: row.debits_posted,
  creditsPosted: row.credits_posted,
});

const recurringLines = (postings: readonly Posting[]): RecurringLine[] => {
  const charges = postings.filter((posting) => posting.signed > 0);
  const byMerchant = groupBy(
    charges,
    (posting) => posting.merchant ?? posting.label,
  );
  const lines = Object.entries(byMerchant).map(([merchant, group]) => ({
    merchant,
    account: group[0]?.account ?? "",
    amount: sumBy(group, (posting) => posting.amount),
  }));
  return orderBy(lines, [(line) => line.amount], ["desc"]);
};

/** The only money the ledger converts baht into. */
const FOREIGN = "usd";

/**
 * The ledger stores no exchange rate. The two legs of a conversion group do
 * imply one, so the most recent pair is the only rate this app will quote.
 * Every instrument keeps a conversion account in its own unit head, so the
 * other side has to be named rather than taken as whatever is not baht: a share
 * count against a cost is a price, not a rate.
 */
const toFxPosition = (
  rows: readonly TransactionRow[],
): FxPosition | undefined => {
  const primaryLeg = rows.find((row) => row.currency.toLowerCase() === PRIMARY);
  const foreignLeg = rows.find((row) => row.currency.toLowerCase() === FOREIGN);
  if (!primaryLeg || !foreignLeg) return undefined;
  if (foreignLeg.amount <= 0) return undefined;
  return {
    rate: primaryLeg.amount / foreignLeg.amount,
    convertedOn: primaryLeg.date,
    lastTransferThb: primaryLeg.amount,
  };
};

const selectFx = (
  transactions: readonly TransactionRow[],
): FxPosition | undefined => {
  const touchesConversion = (row: TransactionRow) =>
    row.debit_account_id.includes(":equity:conversion") ||
    row.credit_account_id.includes(":equity:conversion");
  const groups = groupBy(
    transactions.filter(
      (row) => touchesConversion(row) && row.group_id !== null,
    ),
    (row) => row.group_id ?? "",
  );
  const newestFirst = orderBy(
    Object.values(groups),
    [(rows) => Date.parse(rows[0]?.date ?? "1970-01-01")],
    ["desc"],
  );
  return newestFirst
    .map(toFxPosition)
    .find((position) => position !== undefined);
};

export const selectRuleInput = (snapshot: LedgerSnapshot): RuleInput => {
  const { today, asOf, status, accounts, transactions } = snapshot;
  const month = monthOf(asOf);
  const dayOfMonth = dayOf(asOf);

  const postings = toPostings(transactions);
  const primary = postings.filter((posting) => posting.currency === PRIMARY);
  const expenses = primary.filter((posting) => posting.kind === "expense");
  const income = primary.filter((posting) => posting.kind === "income");

  const expensesByMonth = groupBy(expenses, (posting) => posting.month);
  const incomeByMonth = groupBy(income, (posting) => posting.month);
  const totalsFor = (key: string): MonthTotals => {
    const earned = total(incomeByMonth[key] ?? []);
    const spent = total(expensesByMonth[key] ?? []);
    return { month: key, income: earned, expenses: spent, net: earned - spent };
  };

  // A month the ledger never covered would drag every average toward zero.
  const months = windowOf(asOf)
    .months.map(totalsFor)
    .filter((totals) => totals.income !== 0 || totals.expenses !== 0);

  const completeMonths = months.map((totals) => totals.month);
  const currentMonth = totalsFor(month);

  const trailing = monthsBefore(month, TRAILING_MONTHS).filter((key) =>
    completeMonths.includes(key),
  );
  /** An earlier month cut at the same day, so a part month is compared with a part month. */
  const toDateIn = (postingsIn: readonly Posting[], key: string) =>
    total(upToDay(inMonth(postingsIn, key), clampDay(key, dayOfMonth)));

  const spendToDate = total(upToDay(inMonth(expenses, month), dayOfMonth));
  const priorSpendToDateAvg = average(
    trailing.map((key) => toDateIn(expenses, key)),
  );
  const priorSpendMonthAvg = average(
    trailing.map((key) => total(inMonth(expenses, key))),
  );
  const projectedSpend =
    priorSpendToDateAvg > 0
      ? spendToDate * (priorSpendMonthAvg / priorSpendToDateAvg)
      : spendToDate;

  const accountNames = new Map(accounts.map((row) => [row.id, row.name]));
  const byCategory = groupBy(expenses, (posting) => posting.category);
  const categories: CategoryWindow[] = Object.entries(byCategory).map(
    ([id, lines]) => {
      const current = upToDay(inMonth(lines, month), dayOfMonth);
      const toDate = total(current);
      const priorToDateAvg = average(
        trailing.map((key) => toDateIn(lines, key)),
      );
      const priorMonthAvg = average(
        trailing.map((key) => total(inMonth(lines, key))),
      );
      return {
        id,
        label: accountLabel(id, accountNames.get(id)),
        toDate,
        priorToDateAvg,
        priorMonthAvg,
        projected:
          priorToDateAvg > 0
            ? toDate * (priorMonthAvg / priorToDateAvg)
            : toDate,
        topLines: orderBy(
          current.filter((posting) => posting.signed > 0),
          [(posting) => posting.amount],
          ["desc"],
        )
          .slice(0, TOP_LINES)
          .map(toSpendLine),
      };
    },
  );

  const subscriptionPostings = expenses.filter(
    (posting) => posting.group === "subscriptions",
  );
  const latestComplete = completeMonths.at(-1);
  const monthlyTotal = latestComplete
    ? total(inMonth(subscriptionPostings, latestComplete))
    : 0;
  const priorAverage = average(
    completeMonths
      .slice(0, -1)
      .slice(-SUBSCRIPTION_HISTORY)
      .map((key) => total(inMonth(subscriptionPostings, key))),
  );
  const averageMonthlyIncome = average(months.map((totals) => totals.income));
  const subscriptions: Subscriptions = {
    monthlyTotal,
    priorAverage,
    annualised: monthlyTotal * MONTHS_PER_YEAR,
    shareOfIncome:
      averageMonthlyIncome > 0 ? monthlyTotal / averageMonthlyIncome : 0,
    lines: recurringLines(
      inMonth(subscriptionPostings, latestComplete ?? month),
    ),
  };

  const discretionary = orderBy(
    upToDay(inMonth(expenses, month), dayOfMonth).filter(
      (posting) => posting.signed > 0 && !COMMITTED.has(posting.group),
    ),
    [(posting) => posting.amount],
    ["desc"],
  )
    .slice(0, DISCRETIONARY_LIMIT)
    .map(toSpendLine);

  const paydayDays = completeMonths
    .map((key) => {
      const earners = orderBy(
        inMonth(income, key).filter((posting) => posting.signed > 0),
        [(posting) => posting.amount],
        ["desc"],
      );
      return earners[0]?.day;
    })
    .filter((day): day is number => day !== undefined);
  const incomeToDate = total(inMonth(income, month));

  const parentIds = new Set(
    accounts
      .map((row) => row.parent_id)
      .filter((id): id is string => id !== null),
  );
  const leaves = accounts.filter(
    (row) => !parentIds.has(row.id) && row.id.startsWith(`${PRIMARY}:`),
  );
  const cashRows = leaves.filter(
    (row) => row.type === "asset" && LIQUID_GROUPS.has(segmentOf(row.id, 2)),
  );
  const settlementRow = orderBy(
    cashRows.filter((row) => segmentOf(row.id, 2) === "bank"),
    [(row) => row.credits_posted],
    ["desc"],
  )[0];

  const loanRows = leaves.filter(
    (row) => row.type === "liability" && segmentOf(row.id, 2) === "loan",
  );
  const mortgageRow = orderBy(
    loanRows.filter((row) => row.balance > 0),
    [(row) => row.balance],
    ["desc"],
  )[0];

  const paidIn = (accountId: string, key: string) =>
    sumBy(
      transactions.filter(
        (row) =>
          row.debit_account_id === accountId && monthOf(row.date) === key,
      ),
      (row) => row.amount,
    );

  const toMortgage = (row: AccountRow): MortgageProgress => {
    const interestId = interestAccountFor(row.id, accounts);
    const loanLegs = transactions.filter(
      (entry) =>
        entry.debit_account_id === row.id || entry.credit_account_id === row.id,
    );
    const interestIn = (monthKey: string) =>
      interestId === undefined
        ? 0
        : interestPaidFor(
            loanLegs,
            transactions.filter(
              (entry) =>
                entry.debit_account_id === interestId &&
                monthOf(entry.date) === monthKey,
            ),
          );
    const previous = completeMonths.at(-2);
    const monthlyInterest = latestComplete ? interestIn(latestComplete) : 0;
    const priorInterest = previous ? interestIn(previous) : monthlyInterest;
    return {
      id: row.id,
      name: row.name,
      balance: row.balance,
      principalPaid: row.debits_posted,
      original: row.credits_posted,
      monthlyPrincipal: latestComplete ? paidIn(row.id, latestComplete) : 0,
      monthlyInterest,
      interestDeclinePerMonth: Math.max(priorInterest - monthlyInterest, 0),
    };
  };

  const closedLoans = loanRows
    .filter((row) => row.balance <= 0 && row.credits_posted > 0)
    .map((row): ClosedLoan | undefined => {
      const history = snapshot.closedLoanHistory.filter(
        (entry) =>
          entry.debit_account_id === row.id ||
          entry.credit_account_id === row.id,
      );
      const closedOn = history.reduce<string | undefined>(
        (latest, entry) =>
          latest === undefined || entry.date > latest ? entry.date : latest,
        undefined,
      );
      if (closedOn === undefined) return undefined;
      const payments = history
        .filter((entry) => entry.debit_account_id === row.id)
        .map((entry) => entry.amount);
      return {
        id: row.id,
        name: row.name,
        closedOn,
        typicalPayment: median(payments) ?? 0,
        monthsSinceClosed: monthsUntil(closedOn, asOf),
      };
    })
    .filter((loan): loan is ClosedLoan => loan !== undefined);

  const cash = sumBy(cashRows, (row) => row.balance);
  const interestIncome = total(
    income.filter(
      (posting) =>
        posting.group === "interest" && completeMonths.includes(posting.month),
    ),
  );
  const netWorth = status.net_worth;

  return {
    today,
    asOf,
    month,
    dayOfMonth,
    daysInMonth: daysInMonth(month),
    netWorthThb: netWorth?.net_worth.THB ?? 0,
    netWorthUsd: netWorth?.net_worth.USD ?? 0,
    accounts: leaves.map(toSummary),
    months,
    currentMonth,
    spendToDate,
    priorSpendToDateAvg,
    projectedSpend,
    categories,
    subscriptions,
    discretionary,
    payday: {
      typicalDay: median(paydayDays),
      landed: incomeToDate > 0,
      incomeToDate,
    },
    fx: selectFx(transactions),
    cash,
    investments: sumBy(
      leaves.filter(
        (row) => row.type === "asset" && segmentOf(row.id, 2) === "investment",
      ),
      (row) => row.balance,
    ),
    cards: leaves
      .filter(
        (row) =>
          row.type === "liability" && segmentOf(row.id, 2) === "credit_card",
      )
      .map(toSummary),
    settlement: settlementRow ? toSummary(settlementRow) : undefined,
    mortgage: mortgageRow ? toMortgage(mortgageRow) : undefined,
    closedLoans,
    cashYield:
      cash > 0 && interestIncome > 0 ? interestIncome / cash : undefined,
  };
};
