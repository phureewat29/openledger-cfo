import { orderBy } from "es-toolkit";

import type { CategoryWindow, Insight, Rule, RuleInput } from "../types";
import { formatMonth, formatPercent, formatThb } from "../../format";
import { insightId } from "../types";

const RULE = "category-spike";

/** Before this many days the intra-month rescale amplifies noise into alarm. */
const MIN_ELAPSED_DAYS = 5;
/** A category that normally spends near nothing produces meaningless ratios. */
const MIN_BASELINE = 500;
const MIN_OVERSHOOT = 2_000;
const SPIKE_RATIO = 0.3;
const CRITICAL_RATIO = 1;
const CRITICAL_OVERSHOOT = 10_000;
const MAX_CARDS = 3;

const driverPhrase = (category: CategoryWindow) => {
  const [biggest] = category.topLines;
  if (!biggest) return "";
  if (biggest.amount / category.toDate > 0.5) {
    return ` It is one line: ${biggest.merchant ?? biggest.label} at ${formatThb(biggest.amount)}.`;
  }
  const named = category.topLines
    .slice(0, 2)
    .map((line) => `${line.merchant ?? line.label} ${formatThb(line.amount)}`)
    .join(" and ");
  return ` Driven by ${named}.`;
};

const toInsight = (input: RuleInput, category: CategoryWindow): Insight => {
  const overshoot = category.projected - category.priorMonthAvg;
  const ratio = overshoot / category.priorMonthAvg;
  const daysLeft = input.daysInMonth - input.dayOfMonth;
  const roomToNormal = Math.max(category.priorMonthAvg - category.toDate, 0);
  const impliedRest = category.projected - category.toDate;
  const severity =
    ratio >= CRITICAL_RATIO && overshoot >= CRITICAL_OVERSHOOT
      ? "crit"
      : "warn";

  return {
    id: insightId(RULE, category.id),
    rule: RULE,
    severity,
    title: `${category.label} is running ${formatPercent(ratio)} above normal`,
    body: `${formatThb(category.toDate)} through day ${input.dayOfMonth} of ${formatMonth(input.month)}, against ${formatThb(category.priorToDateAvg)} for the same stretch of recent months. On that curve it lands near ${formatThb(category.projected)} versus a ${formatThb(category.priorMonthAvg)} norm — ${formatThb(overshoot)} over.${driverPhrase(category)}`,
    figures: [
      { label: "So far this month", value: formatThb(category.toDate) },
      {
        label: "Same window, normal",
        value: formatThb(category.priorToDateAvg),
      },
      { label: "On pace for", value: formatThb(category.projected) },
      { label: "Normal month", value: formatThb(category.priorMonthAvg) },
    ],
    action: `Hold ${category.label} to ${formatThb(roomToNormal)} over the remaining ${daysLeft} days to finish at normal — this pace spends ${formatThb(impliedRest)} instead.`,
  };
};

export const categorySpike: Rule = (input) => {
  if (input.dayOfMonth < MIN_ELAPSED_DAYS) return [];

  const spiking = input.categories.filter((category) => {
    if (category.priorToDateAvg < MIN_BASELINE) return false;
    if (category.priorMonthAvg <= 0) return false;
    const overshoot = category.projected - category.priorMonthAvg;
    if (overshoot < MIN_OVERSHOOT) return false;
    return overshoot / category.priorMonthAvg > SPIKE_RATIO;
  });

  return orderBy(
    spiking,
    [
      (category: (typeof spiking)[number]) =>
        category.projected - category.priorMonthAvg,
    ],
    ["desc"],
  )
    .slice(0, MAX_CARDS)
    .map((category) => toInsight(input, category));
};
