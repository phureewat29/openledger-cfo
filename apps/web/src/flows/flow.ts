import { groupBy, orderBy, sumBy } from "es-toolkit";

import type { Posting, TransactionRow } from "~/ledger/postings";
import type { CategoryTotal } from "~/lib/charts/data";
import {
  accountLabel,
  categoryOf,
  PRIMARY,
  segmentOf,
} from "~/ledger/accounts";
import { monthOf, windowOf } from "~/ledger/period";
import { toPostings } from "~/ledger/postings";
import { foldTail } from "~/lib/charts/data";

export type NodeKind = "income" | "hub" | "category" | "outcome";

interface FlowNode {
  readonly id: string;
  readonly label: string;
  readonly kind: NodeKind;
  /** Monthly average in THB — the same unit every link carries. */
  readonly total: number;
}

interface FlowLink {
  readonly source: string;
  readonly target: string;
  readonly value: number;
}

export interface FlowGraph {
  readonly nodes: readonly FlowNode[];
  readonly links: readonly FlowLink[];
}

/** The trailing window's cash flow, as monthly averages. */
export interface Baseline {
  /** Months inside the window the ledger actually covered — the divisor. */
  readonly months: number;
  readonly monthlyIncome: number;
  readonly monthlySpend: number;
  readonly monthlySaved: number;
  readonly graph: FlowGraph;
}

/** One income account or top-level expense group, averaged over the window. */
interface FlowLine {
  readonly id: string;
  readonly label: string;
  readonly monthly: number;
}

const TOP_CATEGORIES = 10;

const HUB_ID = "hub:cash-in";
const SAVED_ID = "outcome:saved";
const OTHER_ID = `${PRIMARY}:expense:other`;

const node = (
  id: string,
  label: string,
  kind: FlowNode["kind"],
  total: number,
): FlowNode => ({ id, label, kind, total });

/** Income feeds one hub; the hub feeds every expense group, and whatever is not spent is "Saved". */
const toFlowGraph = (
  income: readonly FlowLine[],
  categories: readonly FlowLine[],
  saved: number,
): FlowGraph => {
  const cashIn = sumBy(income, (line) => line.monthly);
  // A sankey cannot draw a negative ribbon; overspend is reported as a flag.
  const savedFlow = Math.max(saved, 0);

  const nodes: FlowNode[] = [
    ...income.map((line) => node(line.id, line.label, "income", line.monthly)),
    node(HUB_ID, "Cash in", "hub", cashIn),
    node(SAVED_ID, "Saved", "outcome", savedFlow),
    ...categories.map((line) =>
      node(line.id, line.label, "category", line.monthly),
    ),
  ];

  const links: FlowLink[] = [
    ...income.map((line) => ({
      source: line.id,
      target: HUB_ID,
      value: line.monthly,
    })),
    { source: HUB_ID, target: SAVED_ID, value: savedFlow },
    ...categories.map((line) => ({
      source: HUB_ID,
      target: line.id,
      value: line.monthly,
    })),
  ];

  return { nodes, links };
};

export const toBaseline = (
  rows: readonly TransactionRow[],
  asOf: string,
): Baseline => {
  const covered = new Set(windowOf(asOf).months);
  const postings = toPostings(rows).filter(
    (posting) => posting.currency === PRIMARY && covered.has(posting.month),
  );

  const incomePostings = postings.filter(
    (posting) => posting.kind === "income",
  );
  const expensePostings = postings.filter(
    (posting) => posting.kind === "expense",
  );

  // A month the ledger never reached would drag every average toward zero.
  const active = new Set(
    [...incomePostings, ...expensePostings].map((posting) => posting.month),
  );
  const divisor = Math.max(active.size, 1);

  /** A group that nets negative over a year would invert its ribbon. */
  const perMonth = (group: readonly Posting[]) =>
    Math.max(
      sumBy(group, (posting) => posting.signed),
      0,
    ) / divisor;

  const income = orderBy(
    Object.entries(groupBy(incomePostings, (posting) => posting.account)).map(
      ([id, group]): FlowLine => ({
        id,
        label: accountLabel(id, group[0]?.name),
        monthly: perMonth(group),
      }),
    ),
    [(line) => line.monthly],
    ["desc"],
  ).filter((line) => line.monthly > 0);

  const ranked = orderBy(
    Object.entries(groupBy(expensePostings, (posting) => posting.group)).map(
      ([group, postings]): FlowLine => ({
        id: `${PRIMARY}:expense:${group}`,
        label: accountLabel(`${PRIMARY}:expense:${group}`),
        monthly: perMonth(postings),
      }),
    ),
    [(line) => line.monthly],
    ["desc"],
  ).filter((line) => line.monthly > 0);

  const rest = ranked.slice(TOP_CATEGORIES);
  const categories =
    rest.length === 0
      ? ranked
      : [
          ...ranked.slice(0, TOP_CATEGORIES),
          {
            id: OTHER_ID,
            label: "Other",
            monthly: sumBy(rest, (line) => line.monthly),
          },
        ];

  const monthlyIncome = sumBy(income, (line) => line.monthly);
  const monthlySpend = sumBy(categories, (line) => line.monthly);
  const monthlySaved = monthlyIncome - monthlySpend;

  return {
    months: active.size,
    monthlyIncome,
    monthlySpend,
    monthlySaved,
    graph: toFlowGraph(income, categories, monthlySaved),
  };
};

const TOP_PER_SIDE = 8;

const BALANCE_ID = "source:balance";
const RETAINED_ID = "outcome:retained";

/** The counterparty side of one row, or nothing when the row is the other way. */
type Side = (
  row: TransactionRow,
) => { readonly id: string; readonly name: string | null } | undefined;

/** An income or expense counterparty only means something as its category; any other leaf is a real account. */
const keyOf = (accountId: string): string => {
  const kind = segmentOf(accountId, 1);
  if (kind !== "income" && kind !== "expense") return accountId;
  return categoryOf(accountId);
};

const linesOf = (
  rows: readonly TransactionRow[],
  side: Side,
  divisor: number,
): CategoryTotal[] => {
  const tagged = rows.flatMap((row) => {
    const counterparty = side(row);
    if (counterparty === undefined) return [];
    const key = keyOf(counterparty.id);
    return [
      {
        key,
        // The row names the leaf it touched, which is wrong for a rolled-up category.
        label: accountLabel(
          key,
          key === counterparty.id ? counterparty.name : undefined,
        ),
        amount: row.amount,
      },
    ];
  });

  return foldTail(
    Object.entries(groupBy(tagged, (line) => line.key)).map(
      ([key, group]): CategoryTotal => ({
        key,
        label: group[0]?.label ?? accountLabel(key),
        value: sumBy(group, (line) => line.amount) / divisor,
      }),
    ),
    TOP_PER_SIDE,
  );
};

/**
 * One account as a hub, averaged over the app's trailing window. A counterparty
 * can sit on both sides, so node ids carry their side or the graph would loop.
 */
export const toAccountFlow = (
  rows: readonly TransactionRow[],
  accountId: string,
  accountName: string,
  asOf: string,
): FlowGraph | null => {
  if (!accountId.startsWith(`${PRIMARY}:`)) return null;

  const covered = new Set(windowOf(asOf).months);
  const inWindow = rows.filter((row) => covered.has(monthOf(row.date)));
  // A month the account never traded in would drag every average toward zero.
  const active = new Set(inWindow.map((row) => monthOf(row.date)));
  const divisor = Math.max(active.size, 1);

  const inflow = linesOf(
    inWindow,
    (row) =>
      row.debit_account_id === accountId
        ? { id: row.credit_account_id, name: row.credit_account_name }
        : undefined,
    divisor,
  );
  const outflow = linesOf(
    inWindow,
    (row) =>
      row.credit_account_id === accountId
        ? { id: row.debit_account_id, name: row.debit_account_name }
        : undefined,
    divisor,
  );

  const inTotal = sumBy(inflow, (line) => line.value);
  const outTotal = sumBy(outflow, (line) => line.value);
  if (inTotal <= 0 && outTotal <= 0) return null;

  // A hub has to balance; the balance sheet absorbs whichever side is short.
  const difference = inTotal - outTotal;
  const retained =
    difference > 0
      ? [node(RETAINED_ID, "Retained", "outcome", difference)]
      : [];
  const drawn =
    difference < 0
      ? [node(BALANCE_ID, "From balance", "income", -difference)]
      : [];

  const sources = [
    ...drawn,
    ...inflow.map((line) =>
      node(`in:${line.key}`, line.label, "income", line.value),
    ),
  ];
  const targets = [
    ...retained,
    ...outflow.map((line) =>
      node(`out:${line.key}`, line.label, "category", line.value),
    ),
  ];
  const hub = node(accountId, accountName, "hub", Math.max(inTotal, outTotal));

  const links: FlowLink[] = [
    ...sources.map((source) => ({
      source: source.id,
      target: hub.id,
      value: source.total,
    })),
    ...targets.map((target) => ({
      source: hub.id,
      target: target.id,
      value: target.total,
    })),
  ];

  return { nodes: [...sources, hub, ...targets], links };
};
