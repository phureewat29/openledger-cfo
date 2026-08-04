import type { GoalProgress } from "~/domain/goals";
import type { Insight } from "~/domain/insights/types";
import type { Dashboard } from "~/server/dashboard";
import {
  formatDay,
  formatMonth,
  formatMonths,
  formatPercent,
  formatThb,
  formatUsd,
} from "~/domain/format";
import { goalProgress, movementVerb } from "~/domain/goals";
import { headlineOf } from "~/domain/insights/headline";

const MAX_BRIEFED_INSIGHTS = 8;

const SEVERITY_TAG: Record<Insight["severity"], string> = {
  crit: "CRITICAL",
  warn: "WATCH",
  info: "STEADY",
};

const briefInsight = (insight: Insight, index: number) => {
  const figures = insight.figures
    .map((figure) => `${figure.label} ${figure.value}`)
    .join(" · ");
  return [
    `${index + 1}. [${SEVERITY_TAG[insight.severity]}] ${insight.title}`,
    `   ${insight.body}`,
    figures.length > 0 ? `   Figures: ${figures}` : undefined,
    `   Recommended: ${insight.action}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
};

const briefGoal = (goal: GoalProgress) => {
  const observed = `${movementVerb(goal.mode)} ${formatThb(goal.observedPerMonth)}/mo`;
  const pace =
    goal.requiredPerMonth === undefined
      ? `no deadline; ${observed}`
      : `needs ${formatThb(goal.requiredPerMonth)}/mo, ${observed}`;
  const due = goal.targetDate ? `, due ${goal.targetDate}` : "";
  return `- ${goal.name}: ${formatThb(goal.current)} of ${formatThb(goal.targetAmount)} (${formatPercent(goal.progress)}), ${goal.verdict}${due} — ${pace}`;
};

const paydayLine = (dashboard: Dashboard) => {
  const { payday } = dashboard.input;
  if (payday.landed) return undefined;
  if (payday.typicalDay === undefined) return undefined;
  return `Income normally posts around day ${payday.typicalDay} of the month, so a month-to-date income of ${formatThb(0)} before then is the normal pattern, not a lost salary.`;
};

const briefing = (dashboard: Dashboard) => {
  const headline = headlineOf(dashboard.input);
  const { input } = dashboard;
  const lines = [
    `Net worth: ${formatThb(headline.netWorthThb)} in baht net worth plus ${formatUsd(headline.netWorthUsd)} held in USD.`,
    `Cash on hand: ${formatThb(headline.cash)}${headline.runwayMonths === undefined ? "" : ` (${formatMonths(headline.runwayMonths)} of spending)`}.`,
    `Invested (baht accounts): ${formatThb(input.investments)}.`,
    `${formatMonth(input.month)} through day ${input.dayOfMonth}: income ${formatThb(headline.monthIncome)}, expenses ${formatThb(headline.monthExpenses)}, net ${formatThb(headline.monthNet)}.`,
    paydayLine(dashboard),
    headline.savingsRate === undefined
      ? undefined
      : `Savings rate over the last ${headline.savingsWindow} complete months: ${formatPercent(headline.savingsRate)}.`,
    headline.averageMonthlySpend === undefined
      ? undefined
      : `Average monthly spend across complete months: ${formatThb(headline.averageMonthlySpend)}.`,
    headline.lastMonthSpend === undefined
      ? undefined
      : `On pace for ${formatThb(headline.projectedSpend)} this month against ${formatThb(headline.lastMonthSpend)} last month.`,
    `Lifetime in this ledger: income ${formatThb(dashboard.lifetime.income)}, expenses ${formatThb(dashboard.lifetime.expenses)}.`,
  ];
  return lines.filter((line) => line !== undefined).join("\n");
};

/**
 * The facts the page is showing, for the agent to answer from. Persona, tool
 * guidance and the untrusted-data note belong to the agent package, which owns
 * the prompt and appends this as context.
 *
 * Every number comes from the same pure domain functions that render the page,
 * so the model and the page can never quote different figures. Merchant and
 * description strings were sanitized at the select layer before reaching any
 * insight copy interpolated below.
 */
export const buildBriefing = (dashboard: Dashboard): string => {
  const { input, insights } = dashboard;
  const goals = goalProgress(
    dashboard.goalRows,
    dashboard.prefixFacts,
    dashboard.today,
  );
  const verdicts = insights
    .slice(0, MAX_BRIEFED_INSIGHTS)
    .map(briefInsight)
    .join("\n");
  const goalLines =
    goals.length === 0
      ? "No goals defined yet. Suggest one only if the question invites it."
      : goals.map(briefGoal).join("\n");

  const staleNote = dashboard.stale
    ? ` The ledger has nothing newer than that, so "this month" in the briefing means ${formatMonth(input.month)}, not the current calendar month. Say so if the user asks about right now.`
    : "";

  return `## Ledger
Today is ${formatDay(dashboard.today)}. The ledger holds activity through ${formatDay(input.asOf)}.${staleNote}

## Briefing
${briefing(dashboard)}

## Verdicts already on the page
${verdicts.length > 0 ? verdicts : "No rule fired this month."}

## Goals
${goalLines}`;
};
