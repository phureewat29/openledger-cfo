import { groupBy, orderBy, sumBy } from "es-toolkit";

import type { TransactionRow } from "../postings";
import type { CategoryTotal } from "../series/types";
import type { FlowGraph, FlowLink, FlowNode } from "./types";
import { categoryOf, PRIMARY } from "../accounts";
import { accountLabel } from "../format";
import { monthOf, windowOf } from "../period";

const TOP_PER_SIDE = 8;

const BALANCE_ID = "source:balance";
const RETAINED_ID = "outcome:retained";
const OTHER_KEY = "other";

/** The counterparty side of one row, or nothing when the row is the other way. */
type Side = (
  row: TransactionRow,
) => { readonly id: string; readonly name: string | null } | undefined;

const node = (
  id: string,
  label: string,
  kind: FlowNode["kind"],
  total: number,
): FlowNode => ({ id, label, kind, total });

/**
 * Income and expense counterparties only mean something as a category — nobody
 * reads "Coffee" and "Restaurants" as two places money went. An asset,
 * liability or equity leaf is a real account, so it keeps its own id.
 */
const keyOf = (accountId: string): string => {
  const kind = accountId.split(":")[1] ?? "";
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

  const ranked = orderBy(
    Object.entries(groupBy(tagged, (line) => line.key)).map(
      ([key, group]): CategoryTotal => ({
        key,
        label: group[0]?.label ?? accountLabel(key),
        value: sumBy(group, (line) => line.amount) / divisor,
      }),
    ),
    [(line) => line.value],
    ["desc"],
  ).filter((line) => line.value > 0);

  const rest = ranked.slice(TOP_PER_SIDE);
  if (rest.length === 0) return ranked;
  return [
    ...ranked.slice(0, TOP_PER_SIDE),
    {
      key: OTHER_KEY,
      label: "Other",
      value: sumBy(rest, (line) => line.value),
    },
  ];
};

/**
 * One account as a hub: everything that paid into it on the left, everything it
 * paid out on the right, both averaged over the same trailing window the rest
 * of the app uses. A counterparty can sit on both sides, so node ids carry
 * their side — the same id twice would close the graph into a loop.
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
