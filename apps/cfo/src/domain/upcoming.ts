import { groupBy, orderBy, sumBy } from "es-toolkit";

import type { AccountRow } from "./accounts";
import type { Posting } from "./postings";
import { PRIMARY } from "./accounts";
import { interestAccountFor, interestPaidFor } from "./loans";
import {
  clampDay,
  dayOf,
  isoToday,
  monthOf,
  monthsBefore,
  shiftDays,
  shiftMonth,
} from "./period";
import { median, segmentOf } from "./postings";

const HORIZON_DAYS = 45;
/** Three complete months is the shortest run that separates a subscription from a repeat purchase. */
const RECENT_MONTHS = 3;
const DAY_TOLERANCE = 3;
/** Installments post on the first of the month, or the first banking day after it. */
const LOAN_DUE_DAY = 1;

export type UpcomingSource = "card" | "loan" | "subscription" | "manual";

/** Who put the item on the list, in the width a table column has for it. */
export const SOURCE_LABEL: Record<UpcomingSource, string> = {
  card: "CARD",
  loan: "LOAN",
  subscription: "SUB",
  manual: "YOU",
};

export interface UpcomingItem {
  readonly key: string;
  readonly date: string;
  readonly title: string;
  readonly amount?: number;
  readonly source: UpcomingSource;
  readonly accountId?: string;
  readonly reminderId?: string;
  readonly overdue?: boolean;
}

interface ReminderRow {
  readonly id: string;
  readonly title: string;
  readonly dueDate: string;
  readonly monthly: boolean;
  readonly doneAt: Date | null;
}

interface LedgerInput {
  /** Leaves only: a parent carries no balance and no statement days. */
  readonly accounts: readonly AccountRow[];
  readonly postings: readonly Posting[];
  readonly today: string;
}

const onDay = (monthKey: string, day: number): string =>
  `${monthKey}-${String(clampDay(monthKey, day)).padStart(2, "0")}`;

/**
 * The first occurrence of a day-of-month on or after `from`. A short month has
 * no 31st, so the day clamps to the month end rather than rolling into the next.
 */
const nextOnDay = (from: string, day: number): string => {
  const here = onDay(monthOf(from), day);
  return here >= from ? here : onDay(shiftMonth(monthOf(from), 1), day);
};

const cardItems = (
  accounts: readonly AccountRow[],
  today: string,
): UpcomingItem[] =>
  accounts
    .filter(
      (row) =>
        row.type === "liability" && segmentOf(row.id, 2) === "credit_card",
    )
    .flatMap((row): UpcomingItem[] => [
      ...(row.statement_day === null
        ? []
        : [
            {
              key: `card:${row.id}:statement`,
              date: nextOnDay(today, row.statement_day),
              // "Statement" leads so a truncated row still differs from "Pay …".
              title: `Statement — ${row.name}`,
              source: "card" as const,
              accountId: row.id,
            },
          ]),
      ...(row.due_day === null
        ? []
        : [
            {
              key: `card:${row.id}:due`,
              date: nextOnDay(today, row.due_day),
              title: `${row.name} payment`,
              // A liability balance is what is owed; a credit balance owes nothing.
              amount: Math.max(row.balance, 0),
              source: "card" as const,
              accountId: row.id,
            },
          ]),
    ]);

/**
 * A liability posting is signed negative when the account was debited, which
 * for a loan is principal coming off the balance.
 */
const installmentOf = (
  loan: AccountRow,
  accounts: readonly AccountRow[],
  postings: readonly Posting[],
  month: string,
): number | undefined => {
  const principalLegs = postings.filter(
    (posting) =>
      posting.account === loan.id &&
      posting.month === month &&
      posting.signed < 0,
  );
  if (principalLegs.length === 0) return undefined;

  const interestId = interestAccountFor(loan.id, accounts);
  const interestLegs =
    interestId === undefined
      ? []
      : postings.filter(
          (posting) =>
            posting.account === interestId &&
            posting.month === month &&
            posting.signed > 0,
        );

  return (
    sumBy(principalLegs, (posting) => -posting.signed) +
    interestPaidFor(
      postings.filter((posting) => posting.account === loan.id),
      interestLegs,
    )
  );
};

const loanItems = (
  accounts: readonly AccountRow[],
  postings: readonly Posting[],
  today: string,
): UpcomingItem[] => {
  const lastComplete = shiftMonth(monthOf(today), -1);
  return accounts
    .filter(
      (row) =>
        row.type === "liability" &&
        segmentOf(row.id, 2) === "loan" &&
        row.balance > 0,
    )
    .map((row) => ({
      key: `loan:${row.id}`,
      date: nextOnDay(today, LOAN_DUE_DAY),
      title: `${row.name} installment`,
      amount: installmentOf(row, accounts, postings, lastComplete),
      source: "loan" as const,
      accountId: row.id,
    }));
};

const subscriptionItems = (
  postings: readonly Posting[],
  today: string,
): UpcomingItem[] => {
  const months = monthsBefore(monthOf(today), RECENT_MONTHS);
  const covered = new Set(months);
  const charges = postings.filter(
    (posting) =>
      posting.currency === PRIMARY &&
      posting.kind === "expense" &&
      posting.group === "subscriptions" &&
      posting.signed > 0 &&
      covered.has(posting.month),
  );

  // A merchant the ledger never named is still one line item under its description.
  const byMerchant = groupBy(
    charges,
    (posting) => posting.merchant ?? posting.label,
  );

  return Object.entries(byMerchant).flatMap(
    ([merchant, group]): UpcomingItem[] => {
      const day = median(group.map((posting) => posting.day));
      if (day === undefined) return [];
      const onSchedule = group.filter(
        (posting) => Math.abs(posting.day - day) <= DAY_TOLERANCE,
      );
      // A charge missing from any month in the run is not a subscription.
      const billed = new Set(onSchedule.map((posting) => posting.month));
      if (billed.size < months.length) return [];

      const latest = orderBy(
        onSchedule,
        [(posting) => posting.date],
        ["desc"],
      )[0];
      if (latest === undefined) return [];
      return [
        {
          key: `subscription:${latest.account}:${merchant}`,
          date: nextOnDay(today, day),
          title: merchant,
          amount: latest.amount,
          source: "subscription",
          accountId: latest.account,
        },
      ];
    },
  );
};

const reminderItems = (
  reminders: readonly ReminderRow[],
  today: string,
): UpcomingItem[] =>
  reminders.flatMap((row): UpcomingItem[] => {
    const base = {
      key: `reminder:${row.id}`,
      title: row.title,
      source: "manual" as const,
      reminderId: row.id,
    };

    if (!row.monthly) {
      // A one-shot that was completed has no next occurrence.
      if (row.doneAt !== null) return [];
      return [{ ...base, date: row.dueDate, overdue: row.dueDate < today }];
    }

    const day = dayOf(row.dueDate);
    const next = nextOnDay(today, day);
    const cycleStart = onDay(shiftMonth(monthOf(next), -1), day);
    // A completion is an instant; which cycle it cleared is a ledger calendar day.
    const done = row.doneAt === null ? undefined : isoToday(row.doneAt);
    // Completing a recurring chore clears the cycle it fell in, not the series.
    const date =
      done !== undefined && done >= cycleStart
        ? onDay(shiftMonth(monthOf(next), 1), day)
        : next;
    return [{ ...base, date }];
  });

/**
 * Everything the ledger itself schedules. Statement days, installments and
 * subscriptions are read off postings, so nothing anyone types can change
 * them — which is what lets the two halves of the list be derived apart.
 */
export const ledgerUpcoming = ({
  accounts,
  postings,
  today,
}: LedgerInput): UpcomingItem[] => [
  ...cardItems(accounts, today),
  ...loanItems(accounts, postings, today),
  ...subscriptionItems(postings, today),
];

/** The whole list, in horizon order. Who caps it belongs to whoever shows it. */
export const mergeUpcoming = (
  ledger: readonly UpcomingItem[],
  reminders: readonly ReminderRow[],
  today: string,
): UpcomingItem[] => {
  const horizon = shiftDays(today, HORIZON_DAYS);
  const dated = [...ledger, ...reminderItems(reminders, today)].filter(
    (item) =>
      item.date <= horizon && (item.date >= today || item.overdue === true),
  );

  return orderBy(
    dated,
    [(item) => item.date, (item) => item.title],
    ["asc", "asc"],
  );
};
