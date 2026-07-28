import { orderBy, sumBy } from "es-toolkit";

import type { Insight, Rule, RuleInput } from "../types";
import {
  formatMonths,
  formatMultiple,
  formatPercent,
  formatPercentFine,
  formatThb,
  formatThbCompact,
} from "../../format";
import { insightId } from "../types";

const RULE = "savings-rate";
const TARGET_RATE = 0.2;
const TRAILING_MONTHS = 3;

/** Six months of spending is the usual ceiling for money held as cash. */
const EMERGENCY_MONTHS = 6;
const MIN_IDLE_EXCESS = 50_000;

/** Below twice the target a multiple reads as false precision, so it is a word. */
const formatMultipleOfTarget = (rate: number) => {
  const times = rate / TARGET_RATE;
  return times >= 2 ? formatMultiple(times) : "above";
};

const rateVerdict = (input: RuleInput): Insight[] => {
  const window = input.months.slice(-TRAILING_MONTHS);
  if (window.length === 0) return [];

  const earned = sumBy(window, (month) => month.income);
  if (earned <= 0) return [];

  const kept = sumBy(window, (month) => month.net);
  const rate = kept / earned;
  const span = `${window.length}-month`;
  const months = window.length === 1 ? "one month" : `${window.length} months`;
  const figures = [
    { label: `${span} savings rate`, value: formatPercentFine(rate) },
    { label: "Kept", value: formatThb(kept) },
    { label: "Earned", value: formatThb(earned) },
    { label: "Target", value: formatPercent(TARGET_RATE) },
  ];
  const biggest = orderBy(
    input.categories,
    [(category) => category.priorMonthAvg],
    ["desc"],
  )[0];
  const lever = biggest
    ? `${biggest.label} at ${formatThb(biggest.priorMonthAvg)} a month is the biggest line to attack`
    : "start with the largest recurring category";

  if (rate <= 0) {
    return [
      {
        id: insightId(RULE, "trailing"),
        rule: RULE,
        severity: "crit",
        title: `You spent more than you earned over ${months}`,
        body: `${formatThb(earned)} came in and ${formatThb(earned - kept)} went out — a shortfall of ${formatThb(-kept)}. Nothing else on this page matters until that flips, because every other decision is being funded by the balance sheet rather than by income.`,
        figures,
        action: `Cut ${formatThb(-kept / window.length)} a month of outflow to break even: ${lever}.`,
      },
    ];
  }

  if (rate < TARGET_RATE) {
    const gap = TARGET_RATE * earned - kept;
    return [
      {
        id: insightId(RULE, "trailing"),
        rule: RULE,
        severity: "warn",
        title: `Only ${formatPercent(rate)} of your income is staying`,
        body: `${formatThb(kept)} kept on ${formatThb(earned)} earned across ${months}. That is under the ${formatPercent(TARGET_RATE)} floor, and the gap is ${formatThb(gap)} — roughly ${formatThb(gap / window.length)} a month. This is a spending problem, not an income problem.`,
        figures,
        action: `Find ${formatThb(gap / window.length)} a month: ${lever}.`,
      },
    ];
  }

  return [
    {
      id: insightId(RULE, "trailing"),
      rule: RULE,
      severity: "info",
      title: `You are keeping ${formatPercent(rate)} of what you earn`,
      body: `${formatThb(kept)} banked on ${formatThb(earned)} over ${months} — ${formatMultipleOfTarget(rate)} the ${formatPercent(TARGET_RATE)} floor. Saving is not your problem. Where the savings land is.`,
      figures,
      action:
        "Stop optimising the rate and start directing the surplus — an unallocated surplus quietly becomes idle cash.",
    },
  ];
};

const idleCashVerdict = (input: RuleInput): Insight[] => {
  if (input.months.length === 0) return [];

  const averageSpend =
    sumBy(input.months, (month) => month.expenses) / input.months.length;
  if (averageSpend <= 0) return [];

  const runway = input.cash / averageSpend;
  if (runway <= EMERGENCY_MONTHS) return [];

  const excess = input.cash - EMERGENCY_MONTHS * averageSpend;
  if (excess < MIN_IDLE_EXCESS) return [];

  const yieldNote =
    input.cashYield === undefined
      ? "earning whatever a current account pays"
      : `earning ${formatPercentFine(input.cashYield)} a year`;
  const perPoint = excess / 100;

  return [
    {
      id: insightId(RULE, "idle-cash"),
      rule: RULE,
      severity: "warn",
      title: `${formatThbCompact(excess)} of cash is doing nothing`,
      body: `Your bank and wallet balances total ${formatThb(input.cash)} — ${formatMonths(runway)} of spending at ${formatThb(averageSpend)} a month, against ${formatThb(input.investments)} in your baht investment accounts. Six months is the usual ceiling for money held as cash. The other ${formatThb(excess)} is ${yieldNote}, and every extra percentage point of yield on it is ${formatThb(perPoint)} a year you are choosing not to take.`,
      figures: [
        { label: "Cash on hand", value: formatThb(input.cash) },
        { label: "Runway", value: formatMonths(runway) },
        { label: "Above 6 months", value: formatThb(excess) },
        { label: "Invested (THB)", value: formatThb(input.investments) },
      ],
      action: `Move ${formatThb(excess)} into the investment accounts you already hold, or state out loud what the comfort is worth — this is the most expensive habit in the ledger and it does not look like one.`,
    },
  ];
};

export const savingsRate: Rule = (input) => [
  ...rateVerdict(input),
  ...idleCashVerdict(input),
];
