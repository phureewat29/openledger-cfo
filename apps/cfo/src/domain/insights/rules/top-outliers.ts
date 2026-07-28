import { sumBy } from "es-toolkit";

import type { Rule, SpendLine } from "../types";
import { formatDay, formatMonth, formatPercent, formatThb } from "../../format";
import { insightId } from "../types";

const RULE = "top-outliers";
const SUBJECT = "month";
const TOP_N = 3;
const HEAVY_SHARE = 0.4;

const nameOf = (line: SpendLine) => line.merchant ?? line.label;

const listPhrase = (lines: readonly SpendLine[]) => {
  const parts = lines.map(
    (line) => `${nameOf(line)} ${formatThb(line.amount)}`,
  );
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
};

export const topOutliers: Rule = (input) => {
  const top = input.discretionary.slice(0, TOP_N);
  if (top.length === 0) return [];
  if (input.spendToDate <= 0) return [];

  const total = sumBy(top, (line) => line.amount);
  const share = total / input.spendToDate;
  const rest = input.spendToDate - total;
  const [biggest] = top;
  const severity = share > HEAVY_SHARE ? "warn" : "info";
  const dateNote = biggest
    ? ` The largest landed on ${formatDay(biggest.date)}.`
    : "";

  return [
    {
      id: insightId(RULE, SUBJECT),
      rule: RULE,
      severity,
      title: `${top.length === 1 ? "One charge is" : `${top.length} charges are`} ${formatPercent(share)} of the month`,
      body: `${listPhrase(top)} — ${formatThb(total)} of the ${formatThb(input.spendToDate)} spent so far in ${formatMonth(input.month)}. None of them is a loan payment or a bill; every one was a decision.${dateNote}`,
      figures: top.map((line) => ({
        label: nameOf(line),
        value: formatThb(line.amount),
      })),
      action: `Start here if you want ${formatMonth(input.month)} to land at normal — the other ${formatThb(rest)} is mostly commitments you already made.`,
    },
  ];
};
