import { groupBy, orderBy, sumBy } from "es-toolkit";

import type { Posting, TransactionRow } from "../postings";
import type {
  Baseline,
  CategoryLine,
  FlowGraph,
  FlowLink,
  FlowNode,
  IncomeLine,
} from "./types";
import { PRIMARY } from "../accounts";
import { accountLabel } from "../format";
import { windowOf } from "../period";
import { toPostings } from "../postings";

const TOP_CATEGORIES = 10;

const HUB_ID = "hub:cash-in";
const SAVED_ID = "outcome:saved";
const OTHER_KEY = "other";
const OTHER_ID = `${PRIMARY}:expense:${OTHER_KEY}`;

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

const node = (
  id: string,
  label: string,
  kind: FlowNode["kind"],
  total: number,
): FlowNode => ({ id, label, kind, total });

/**
 * Income accounts feed one hub, the hub feeds every expense group plus what
 * survived. Whatever is not spent is "Saved" by definition — it went to a
 * savings balance, an investment, or a loan principal.
 */
const toFlowGraph = (
  income: readonly IncomeLine[],
  categories: readonly CategoryLine[],
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
  const { from, to, months } = windowOf(asOf);
  const covered = new Set(months);
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
      ([id, group]): IncomeLine => ({
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
      ([key, group]): CategoryLine => ({
        key,
        id: `${PRIMARY}:expense:${key}`,
        label: accountLabel(`${PRIMARY}:expense:${key}`),
        monthly: perMonth(group),
        committed: COMMITTED.has(key),
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
            key: OTHER_KEY,
            id: OTHER_ID,
            label: "Other",
            monthly: sumBy(rest, (line) => line.monthly),
            committed: false,
          },
        ];

  const monthlyIncome = sumBy(income, (line) => line.monthly);
  const monthlySpend = sumBy(categories, (line) => line.monthly);
  const monthlySaved = monthlyIncome - monthlySpend;

  return {
    asOf,
    from,
    to,
    months: active.size,
    income,
    categories,
    monthlyIncome,
    monthlySpend,
    monthlySaved,
    savingsRate: monthlyIncome > 0 ? monthlySaved / monthlyIncome : 0,
    graph: toFlowGraph(income, categories, monthlySaved),
  };
};
