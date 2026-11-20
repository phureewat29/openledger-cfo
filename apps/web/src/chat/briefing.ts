import { attemptAsync, sumBy } from "es-toolkit";

import { caller } from "@openledger-cfo/api";

import type { Dashboard } from "~/dashboard/load";
import type { Insight } from "~/insights/types";
import type { GoalProgress } from "~/plan/goals";
import { loadAccount } from "~/accounts/load";
import { headlineOf } from "~/insights/headline";
import { insightsFrom } from "~/insights/load";
import { ledgerWindow } from "~/ledger/load";
import { isStale } from "~/ledger/period";
import {
  formatDay,
  formatMonth,
  formatMonths,
  formatPercent,
  formatThb,
  formatUsd,
  moneyOf,
} from "~/lib/format";
import { goalProgress, movementVerb } from "~/plan/goals";
import { planFrom } from "~/plan/load";

/** All the briefing quotes of the Everything page's read model. */
type Facts = Pick<Dashboard, "today" | "stale" | "input" | "insights">;

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

const paydayLine = (facts: Facts) => {
  const { payday } = facts.input;
  if (payday.landed) return undefined;
  if (payday.typicalDay === undefined) return undefined;
  return `Income normally posts around day ${payday.typicalDay} of the month, so a month-to-date income of ${formatThb(0)} before then is the normal pattern, not a lost salary.`;
};

interface Lifetime {
  readonly income: number;
  readonly expenses: number;
}

const briefing = (facts: Facts, lifetime: Lifetime) => {
  const headline = headlineOf(facts.input);
  const { input } = facts;
  const lines = [
    `Net worth: ${formatThb(headline.netWorthThb)} in baht net worth plus ${formatUsd(headline.netWorthUsd)} held in USD.`,
    `Cash on hand: ${formatThb(headline.cash)}${headline.runwayMonths === undefined ? "" : ` (${formatMonths(headline.runwayMonths)} of spending)`}.`,
    `Invested (baht accounts): ${formatThb(input.investments)}.`,
    `${formatMonth(input.month)} through day ${input.dayOfMonth}: income ${formatThb(headline.monthIncome)}, expenses ${formatThb(headline.monthExpenses)}, net ${formatThb(headline.monthNet)}.`,
    paydayLine(facts),
    headline.savingsRate === undefined
      ? undefined
      : `Savings rate over the last ${headline.savingsWindow} complete months: ${formatPercent(headline.savingsRate)}.`,
    headline.averageMonthlySpend === undefined
      ? undefined
      : `Average monthly spend across complete months: ${formatThb(headline.averageMonthlySpend)}.`,
    headline.lastMonthSpend === undefined
      ? undefined
      : `On pace for ${formatThb(headline.projectedSpend)} this month against ${formatThb(headline.lastMonthSpend)} last month.`,
    `Lifetime in this ledger: income ${formatThb(lifetime.income)}, expenses ${formatThb(lifetime.expenses)}.`,
  ];
  return lines.filter((line) => line !== undefined).join("\n");
};

/** Page facts only: persona, tool guidance and the untrusted-data note belong to the agent package. */
const buildBriefing = (
  facts: Facts,
  goals: readonly GoalProgress[],
  lifetime: Lifetime,
): string => {
  const { input, insights } = facts;
  const verdicts = insights
    .slice(0, MAX_BRIEFED_INSIGHTS)
    .map(briefInsight)
    .join("\n");
  const goalLines =
    goals.length === 0
      ? "No goals defined yet. Suggest one only if the question invites it."
      : goals.map(briefGoal).join("\n");

  const staleNote = facts.stale
    ? ` The ledger has nothing newer than that, so "this month" in the briefing means ${formatMonth(input.month)}, not the current calendar month. Say so if the user asks about right now.`
    : "";

  return `## Ledger
Today is ${formatDay(facts.today)}. The ledger holds activity through ${formatDay(input.asOf)}.${staleNote}

## Briefing
${briefing(facts, lifetime)}

## Verdicts already on the page
${verdicts.length > 0 ? verdicts : "No rule fired this month."}

## Goals
${goalLines}`;
};

/** Wide enough to be "everything"; `report` echoes back the range it used. */
const LEDGER_EPOCH = "2000-01-01";

/**
 * Undefined when the ledger does not answer: the agent then works from its tools
 * alone. One window read feeds both views, since a route handler has no request cache.
 */
const ledgerFacts = async (): Promise<string | undefined> => {
  const [, facts] = await attemptAsync(async () => {
    const window = await ledgerWindow();
    const [{ input, insights }, plan, report] = await Promise.all([
      insightsFrom(window),
      planFrom(window),
      caller.ledger.report({ from: LEDGER_EPOCH, to: window.today }),
    ]);
    return buildBriefing(
      {
        today: window.today,
        stale: isStale(window.asOf, window.today),
        input,
        insights,
      },
      goalProgress(plan.goalRows, plan.prefixFacts, plan.today),
      {
        income: report.income.THB ?? 0,
        expenses: report.expenses.THB ?? 0,
      },
    );
  });
  return facts ?? undefined;
};

const accountViewBlock = async (id: string): Promise<string | undefined> => {
  const [, view] = await attemptAsync(() => loadAccount(id));
  if (!view) return undefined;

  const inflow = sumBy(view.monthly, (month) => month.in);
  const outflow = sumBy(view.monthly, (month) => month.out);
  const money = moneyOf(view.currency);
  // The totals sum `monthly`, so the span quoted must be `monthly`'s own.
  const from = view.monthly[0]
    ? `${view.monthly[0].month}-01`
    : view.window.from;
  return [
    "## Current view",
    `The user is looking at account ${view.id} — ${view.name} (${view.type}).`,
    `Balance ${money(view.balance)} · last activity ${formatDay(view.asOf)}.`,
    `Trailing window ${from} → ${view.asOf}: in ${money(inflow)}, out ${money(outflow)}.`,
    'Answer questions about "this account" against these figures; use tools for anything deeper.',
  ].join("\n");
};

/** `/` or `/accounts/<id>`; any other path briefs as `/`. */
const VIEW_PATH = /^\/(?:accounts\/([A-Za-z0-9:%._-]+))?$/;

/**
 * The client sends only its route; every fact here is re-derived on the server,
 * so the model is never fed a figure the server did not compute.
 */
export const systemFor = async (path = "/"): Promise<string | undefined> => {
  const facts = await ledgerFacts();
  const account = VIEW_PATH.exec(path)?.[1];
  if (account === undefined) return facts;

  const view = await accountViewBlock(decodeURIComponent(account));
  if (!view) return facts;
  return facts ? `${facts}\n\n${view}` : view;
};
