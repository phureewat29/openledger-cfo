import { sumBy } from "es-toolkit";

import type { Insight, RecurringLine, Rule, RuleInput } from "../types";
import { formatPercent, formatPercentFine, formatThb } from "../../format";
import { insightId } from "../types";

const RULE = "subscription-creep";
const CREEP_RATIO = 0.1;
const CREEP_MIN = 300;
const NAMED_LINES = 3;

const nameLines = (lines: readonly RecurringLine[]) =>
  lines
    .slice(0, NAMED_LINES)
    .map((line) => `${line.merchant} ${formatThb(line.amount)}`)
    .join(", ");

const figuresFor = (input: RuleInput) => [
  { label: "Per month", value: formatThb(input.subscriptions.monthlyTotal) },
  { label: "Per year", value: formatThb(input.subscriptions.annualised) },
  {
    label: "Recent average",
    value: formatThb(input.subscriptions.priorAverage),
  },
  {
    label: "Share of income",
    value: formatPercentFine(input.subscriptions.shareOfIncome),
  },
];

const biggestLineAction = (lines: readonly RecurringLine[]) => {
  const [biggest] = lines;
  if (!biggest)
    return "Review the list line by line and cancel what you cannot name a use for.";
  return `${biggest.merchant} is ${formatThb(biggest.amount * 12)} a year. If you cannot point at what it did last month, that is the cheapest cut on this page — decided once, banked every month after.`;
};

export const subscriptionCreep: Rule = (input) => {
  const { subscriptions } = input;
  if (subscriptions.monthlyTotal <= 0) return [];
  if (subscriptions.lines.length === 0) return [];

  const change = subscriptions.monthlyTotal - subscriptions.priorAverage;
  const namedTotal = sumBy(
    subscriptions.lines.slice(0, NAMED_LINES),
    (line) => line.amount,
  );
  const concentration = namedTotal / subscriptions.monthlyTotal;
  const creeping =
    change > CREEP_MIN && change / subscriptions.priorAverage > CREEP_RATIO;

  const insight: Insight = creeping
    ? {
        id: insightId(RULE, "total"),
        rule: RULE,
        severity: "warn",
        title: `Subscriptions crept up to ${formatThb(subscriptions.monthlyTotal)} a month`,
        body: `That is ${formatThb(change)} more than the ${formatThb(subscriptions.priorAverage)} you were paying, and recurring charges never creep back down on their own. Annualised you are now committed to ${formatThb(subscriptions.annualised)} — ${formatPercentFine(subscriptions.shareOfIncome)} of everything you earn. The top ${NAMED_LINES} are ${formatPercent(concentration)} of it: ${nameLines(subscriptions.lines)}.`,
        figures: figuresFor(input),
        action: biggestLineAction(subscriptions.lines),
      }
    : {
        id: insightId(RULE, "total"),
        rule: RULE,
        severity: "info",
        title: `Subscriptions are steady at ${formatThb(subscriptions.monthlyTotal)} a month`,
        body: `Nothing is creeping — this matches the ${formatThb(subscriptions.priorAverage)} recent average almost exactly. Steady is not the same as free: it is ${formatThb(subscriptions.annualised)} a year, ${formatPercentFine(subscriptions.shareOfIncome)} of your income, and the top ${NAMED_LINES} lines are ${formatPercent(concentration)} of the bill — ${nameLines(subscriptions.lines)}.`,
        figures: figuresFor(input),
        action: biggestLineAction(subscriptions.lines),
      };

  return [insight];
};
