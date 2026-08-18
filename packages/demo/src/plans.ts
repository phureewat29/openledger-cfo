import { countBy, maxBy, orderBy, sumBy } from "es-toolkit";

import type { Result } from "@openledger-cfo/openledger";
import { db } from "@openledger-cfo/db/client";
import { budget, goal, money, reminder } from "@openledger-cfo/db/schema";
import {
  categoryOf,
  err,
  isoToday,
  matchesPrefix,
  ok,
} from "@openledger-cfo/openledger";

import type { Month } from "./calendar";
import type { Life } from "./dataset";
import type { Check } from "./invariants";
import type { SeedRow } from "./types";
import { ACCOUNT } from "./accounts";
import { addMonths, dayIn } from "./calendar";
import { allRows } from "./dataset";
import { formatMoney } from "./money";
import { legsOf } from "./types";

interface PlansReport {
  budgets: number;
  goals: number;
  reminders: number;
  checks: Check[];
}

type BudgetInsert = typeof budget.$inferInsert;
type GoalInsert = typeof goal.$inferInsert;
type ReminderInsert = typeof reminder.$inferInsert;

const monthOf = (iso: string): Month => ({
  year: Number(iso.slice(0, 4)),
  month: Number(iso.slice(5, 7)),
});

const nextMonthlyOccurrence = (today: string, day: number): string => {
  const thisMonth = monthOf(today);
  const candidate = dayIn(thisMonth, day);
  return candidate > today ? candidate : dayIn(addMonths(thisMonth, 1), day);
};

const nextAnnualOccurrence = (
  today: string,
  month: number,
  day: number,
): string => {
  const { year } = monthOf(today);
  const candidate = dayIn({ year, month }, day);
  return candidate > today ? candidate : dayIn({ year: year + 1, month }, day);
};

const nextQuarterBoundary = (today: string): string => {
  const current = monthOf(today);
  const quarterStart: Month = {
    year: current.year,
    month: Math.floor((current.month - 1) / 3) * 3 + 1,
  };
  return dayIn(addMonths(quarterStart, 3), 1);
};

interface DatedLeg {
  readonly date: string;
  readonly debit_account: string;
  readonly credit_account: string;
  readonly amount: number;
}

const legsWithDate = (rows: readonly SeedRow[]): DatedLeg[] =>
  rows.flatMap((seedRow) =>
    legsOf(seedRow).map((legEntry) => ({ date: seedRow.date, ...legEntry })),
  );

const isExpenseAccount = (accountId: string): boolean =>
  accountId.split(":")[1] === "expense";

const latestByDate = <T extends { date: string }>(
  rows: readonly T[],
): T | undefined => orderBy(rows, [(row) => row.date], ["desc"])[0];

const roundUpTo = (amount: number, step: number): number =>
  Math.ceil(amount / step) * step;

const BUDGET_WINDOW_MONTHS = 12;
const TOP_BUDGET_CATEGORIES = 8;
const BUDGET_PERCENTILE = 75;
const BUDGET_ROUND_STEP = 500;

/** Fixed obligations, not spending choices, so they never take a discretionary budget slot. */
const OBLIGATION_CATEGORIES = new Set([
  "thb:expense:interest",
  "thb:expense:tax",
  "thb:expense:fees",
  "thb:expense:insurance",
]);

/** Linear-interpolation percentile (numpy's default): exact on the sample, no binning. */
const percentileOf = (
  sortedAscending: readonly number[],
  p: number,
): number => {
  const index = (p / 100) * (sortedAscending.length - 1);
  const lower = Math.floor(index);
  const lowerValue = sortedAscending[lower] ?? 0;
  const upper = Math.ceil(index);
  if (lower === upper) return lowerValue;
  const upperValue = sortedAscending[upper] ?? 0;
  return lowerValue + (upperValue - lowerValue) * (index - lower);
};

const buildBudgets = (life: Life): BudgetInsert[] => {
  const window = life.months.slice(-BUDGET_WINDOW_MONTHS);
  const monthKeys = window.map((chunk) => chunk.month);

  const perCategoryMonth = new Map<string, Map<string, number>>();
  for (const chunk of window) {
    for (const seedRow of chunk.rows) {
      for (const legEntry of legsOf(seedRow)) {
        if (!isExpenseAccount(legEntry.debit_account)) continue;
        const category = categoryOf(legEntry.debit_account);
        const perMonth =
          perCategoryMonth.get(category) ?? new Map<string, number>();
        perMonth.set(
          chunk.month,
          (perMonth.get(chunk.month) ?? 0) + legEntry.amount,
        );
        perCategoryMonth.set(category, perMonth);
      }
    }
  }

  const candidates = [...perCategoryMonth.entries()]
    .filter(([category]) => !OBLIGATION_CATEGORIES.has(category))
    .map(([category, perMonth]) => {
      const values = monthKeys.map((month) => perMonth.get(month) ?? 0);
      return { category, values, total: sumBy(values, (value) => value) };
    });

  const top = orderBy(candidates, [(entry) => entry.total], ["desc"]).slice(
    0,
    TOP_BUDGET_CATEGORIES,
  );

  return top.map(({ category, values }) => {
    const limit = roundUpTo(
      percentileOf(
        values.toSorted((a, b) => a - b),
        BUDGET_PERCENTILE,
      ),
      BUDGET_ROUND_STEP,
    );
    return { category, monthlyLimit: money(limit) };
  });
};

const RETIREMENT_TARGET = 20_000_000;
const RUNWAY_MONTHS = 12;
const RUNWAY_ROUND_STEP = 100_000;
const JAPAN_TRIP_TARGET = 250_000;
const PARENTS_CARE_TARGET = 1_000_000;

const FUND_ACCOUNTS = [
  ACCOUNT.fundKChange,
  ACCOUNT.fundScbSet50,
  ACCOUNT.fundEsGlobal,
];

const buildGoals = (life: Life): Result<GoalInsert[], string> => {
  const fundPrefix = categoryOf(ACCOUNT.fundKChange);
  const fundsShareOnePrefix = FUND_ACCOUNTS.every(
    (accountId) => categoryOf(accountId) === fundPrefix,
  );
  if (!fundsShareOnePrefix) {
    return err("Thai fund accounts do not share one account prefix");
  }

  const averageMonthlyExpense =
    life.meta.expected.thbExpenses / life.meta.expected.counts.months;
  const runwayTarget = roundUpTo(
    averageMonthlyExpense * RUNWAY_MONTHS,
    RUNWAY_ROUND_STEP,
  );

  const mortgagePrincipal = sumBy(
    allRows(life)
      .flatMap(legsOf)
      .filter((legEntry) => legEntry.credit_account === ACCOUNT.mortgageCondo),
    (legEntry) => legEntry.amount,
  );

  return ok([
    {
      name: "Debt-free",
      accountPrefix: ACCOUNT.mortgageCondo,
      targetAmount: money(mortgagePrincipal),
      targetDate: "2033-12-31",
    },
    {
      name: "Retirement fund",
      accountPrefix: fundPrefix,
      targetAmount: money(RETIREMENT_TARGET),
      targetDate: "2045-12-31",
    },
    {
      name: "12-month runway",
      accountPrefix: ACCOUNT.ttbMe,
      targetAmount: money(runwayTarget),
      targetDate: null,
    },
    {
      name: "Japan trip",
      accountPrefix: ACCOUNT.uob,
      targetAmount: money(JAPAN_TRIP_TARGET),
      targetDate: "2027-04-30",
    },
    {
      name: "Parents' care fund",
      accountPrefix: ACCOUNT.bay,
      targetAmount: money(PARENTS_CARE_TARGET),
      targetDate: "2028-12-31",
    },
  ]);
};

const CREDIT_CARD_PREFIX = "thb:liability:credit_card:";
const INSURANCE_PREFIX = "thb:expense:insurance:";
const TAX_FILING_DATE = "2027-03-31";
const FALLBACK_INSURANCE_AMOUNT = 28_500;
const FALLBACK_INSURANCE_MONTH = 12;
const FALLBACK_INSURANCE_DAY = 1;

const modeDayOfMonth = (dates: readonly string[]): number | undefined => {
  const counts = countBy(dates, (date) => date.slice(8, 10));
  const mostCommon = maxBy(Object.entries(counts), ([, count]) => count);
  return mostCommon === undefined ? undefined : Number(mostCommon[0]);
};

const buildCardReminders = (
  life: Life,
  today: string,
): Result<ReminderInsert[], string> => {
  const rows: ReminderInsert[] = [];
  for (const account of life.accounts) {
    if (!account.id.startsWith(CREDIT_CARD_PREFIX)) continue;
    if (account.due_day === undefined) {
      return err(`card ${account.id} has no due_day in the dataset`);
    }
    rows.push({
      title: `Pay ${account.name}`,
      dueDate: nextMonthlyOccurrence(today, account.due_day),
      monthly: true,
      note: null,
    });
  }
  return ok(rows);
};

const buildMortgageReminder = (
  life: Life,
  today: string,
): Result<ReminderInsert, string> => {
  const paymentDates = legsWithDate(allRows(life))
    .filter((legEntry) => legEntry.debit_account === ACCOUNT.mortgageCondo)
    .map((legEntry) => legEntry.date);
  const dueDay = modeDayOfMonth(paymentDates);
  if (dueDay === undefined) {
    return err("no mortgage payments in the dataset to infer a due day from");
  }
  return ok({
    title: "Mortgage payment",
    dueDate: nextMonthlyOccurrence(today, dueDay),
    monthly: true,
    note: null,
  });
};

/** Only reached if the dataset ever ships with no insurance-category spending at all. */
const fallbackInsuranceReminder = (today: string): ReminderInsert => ({
  title: "Home insurance premium",
  dueDate: nextAnnualOccurrence(
    today,
    FALLBACK_INSURANCE_MONTH,
    FALLBACK_INSURANCE_DAY,
  ),
  monthly: false,
  note: `Estimated premium ฿${formatMoney(FALLBACK_INSURANCE_AMOUNT)} (no insurance history in the dataset)`,
});

const buildInsuranceReminder = (life: Life, today: string): ReminderInsert => {
  const allLegs = legsWithDate(allRows(life));
  const condoInsurance = allLegs.filter(
    (legEntry) => legEntry.debit_account === ACCOUNT.condoInsurance,
  );
  const anyInsurance =
    condoInsurance.length > 0
      ? condoInsurance
      : allLegs.filter((legEntry) =>
          legEntry.debit_account.startsWith(INSURANCE_PREFIX),
        );
  const latest = latestByDate(anyInsurance);
  if (!latest) return fallbackInsuranceReminder(today);

  return {
    title: "Home insurance premium",
    dueDate: nextAnnualOccurrence(
      today,
      Number(latest.date.slice(5, 7)),
      Number(latest.date.slice(8, 10)),
    ),
    monthly: false,
    note: `Last premium ฿${formatMoney(latest.amount)}, paid ${latest.date}`,
  };
};

const buildReminders = (
  life: Life,
  today: string,
): Result<ReminderInsert[], string> => {
  const cards = buildCardReminders(life, today);
  if (!cards.ok) return cards;
  const mortgage = buildMortgageReminder(life, today);
  if (!mortgage.ok) return mortgage;

  return ok([
    ...cards.value,
    mortgage.value,
    buildInsuranceReminder(life, today),
    {
      title: "Personal income tax filing",
      dueDate: TAX_FILING_DATE,
      monthly: false,
      note: null,
    },
    {
      title: "Parents' health checkup",
      dueDate: nextQuarterBoundary(today),
      monthly: false,
      note: null,
    },
  ]);
};

const budgetChecks = (life: Life, budgets: BudgetInsert[]): Check[] =>
  budgets.map((row) => {
    const matched = life.accounts.some(
      (account) =>
        isExpenseAccount(account.id) && matchesPrefix(account.id, row.category),
    );
    return {
      name: `budget ${row.category} matches a dataset expense account`,
      ok: matched,
      detail: matched
        ? ""
        : "no expense account in the dataset matches this category",
    };
  });

const goalChecks = (life: Life, goals: GoalInsert[]): Check[] =>
  goals.map((row) => {
    const matched = life.accounts.some((account) =>
      matchesPrefix(account.id, row.accountPrefix),
    );
    return {
      name: `goal "${row.name}" prefix matches a dataset account`,
      ok: matched,
      detail: matched ? "" : `no account matches prefix ${row.accountPrefix}`,
    };
  });

/**
 * Resets and reseeds the control plane's plans from the committed dataset —
 * deterministic except for `today`, so a rerun is a no-op. A plan that cannot
 * be built is an error; one that does not line up is a failing check, not a
 * throw.
 */
export const seedPlans = (life: Life): Result<PlansReport, string> => {
  const today = isoToday();
  const budgets = buildBudgets(life);
  const goals = buildGoals(life);
  if (!goals.ok) return goals;
  const reminders = buildReminders(life, today);
  if (!reminders.ok) return reminders;

  // One statement: a half-replaced control plane is worse than an untouched one.
  db.transaction((tx) => {
    tx.delete(budget).run();
    tx.delete(goal).run();
    tx.delete(reminder).run();

    tx.insert(budget).values(budgets).run();
    tx.insert(goal).values(goals.value).run();
    tx.insert(reminder).values(reminders.value).run();
  });

  return ok({
    budgets: budgets.length,
    goals: goals.value.length,
    reminders: reminders.value.length,
    checks: [...budgetChecks(life, budgets), ...goalChecks(life, goals.value)],
  });
};
