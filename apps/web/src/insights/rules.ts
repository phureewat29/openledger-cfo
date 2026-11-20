import { maxBy, orderBy, sortBy, sumBy } from "es-toolkit";

import type { Headline } from "./headline";
import type {
  CategoryWindow,
  Insight,
  RecurringLine,
  Rule,
  RuleInput,
  RuleKey,
  Severity,
  SpendLine,
} from "./types";
import { impliedAprOf, MAX_CLOSED_LOANS } from "~/ledger/loans";
import {
  formatDay,
  formatMonth,
  formatMonths,
  formatMultiple,
  formatPercent,
  formatPercentFine,
  formatRate,
  formatStamp,
  formatThb,
  formatThbCompact,
  formatUsd,
} from "~/lib/format";
import { headlineOf } from "./headline";
import { insightId } from "./types";

const SAVINGS_RULE = "savings-rate";
const TARGET_RATE = 0.2;

/** Six months of spending is the usual ceiling for money held as cash. */
const EMERGENCY_MONTHS = 6;
const MIN_IDLE_EXCESS = 50_000;

/** Below twice the target a multiple reads as false precision, so it is a word. */
const formatMultipleOfTarget = (rate: number) => {
  const times = rate / TARGET_RATE;
  return times >= 2 ? formatMultiple(times) : "above";
};

const rateVerdict = (input: RuleInput, headline: Headline): Insight[] => {
  const {
    savingsRate: rate,
    savingsWindow: size,
    savingsEarned: earned,
    savingsKept: kept,
  } = headline;
  if (rate === undefined) return [];

  const span = `${size}-month`;
  const months = size === 1 ? "one month" : `${size} months`;
  const figures = [
    { label: `${span} savings rate`, value: formatPercentFine(rate) },
    { label: "Kept", value: formatThb(kept) },
    { label: "Earned", value: formatThb(earned) },
    { label: "Target", value: formatPercent(TARGET_RATE) },
  ];
  const biggest = maxBy(input.categories, (category) => category.priorMonthAvg);
  const lever = biggest
    ? `${biggest.label} at ${formatThb(biggest.priorMonthAvg)} a month is the biggest line to attack`
    : "start with the largest recurring category";

  if (rate <= 0) {
    return [
      {
        id: insightId(SAVINGS_RULE, "trailing"),
        rule: SAVINGS_RULE,
        severity: "crit",
        title: `You spent more than you earned over ${months}`,
        body: `${formatThb(earned)} came in and ${formatThb(earned - kept)} went out — a shortfall of ${formatThb(-kept)}. Nothing else on this page matters until that flips, because every other decision is being funded by the balance sheet rather than by income.`,
        figures,
        action: `Cut ${formatThb(-kept / size)} a month of outflow to break even: ${lever}.`,
      },
    ];
  }

  if (rate < TARGET_RATE) {
    const gap = TARGET_RATE * earned - kept;
    return [
      {
        id: insightId(SAVINGS_RULE, "trailing"),
        rule: SAVINGS_RULE,
        severity: "warn",
        title: `Only ${formatPercent(rate)} of your income is staying`,
        body: `${formatThb(kept)} kept on ${formatThb(earned)} earned across ${months}. That is under the ${formatPercent(TARGET_RATE)} floor, and the gap is ${formatThb(gap)} — roughly ${formatThb(gap / size)} a month. This is a spending problem, not an income problem.`,
        figures,
        action: `Find ${formatThb(gap / size)} a month: ${lever}.`,
      },
    ];
  }

  return [
    {
      id: insightId(SAVINGS_RULE, "trailing"),
      rule: SAVINGS_RULE,
      severity: "info",
      title: `You are keeping ${formatPercent(rate)} of what you earn`,
      body: `${formatThb(kept)} banked on ${formatThb(earned)} over ${months} — ${formatMultipleOfTarget(rate)} the ${formatPercent(TARGET_RATE)} floor. Saving is not your problem. Where the savings land is.`,
      figures,
      action:
        "Stop optimising the rate and start directing the surplus — an unallocated surplus quietly becomes idle cash.",
    },
  ];
};

const idleCashVerdict = (input: RuleInput, headline: Headline): Insight[] => {
  const { averageMonthlySpend: averageSpend, runwayMonths: runway } = headline;
  if (averageSpend === undefined || runway === undefined) return [];
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
      id: insightId(SAVINGS_RULE, "idle-cash"),
      rule: SAVINGS_RULE,
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

const savingsRate: Rule = (input) => {
  const headline = headlineOf(input);
  return [...rateVerdict(input, headline), ...idleCashVerdict(input, headline)];
};

const SPIKE_RULE = "category-spike";

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
    id: insightId(SPIKE_RULE, category.id),
    rule: SPIKE_RULE,
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

const categorySpike: Rule = (input) => {
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

const CREEP_RULE = "subscription-creep";
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

const subscriptionCreep: Rule = (input) => {
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
        id: insightId(CREEP_RULE, "total"),
        rule: CREEP_RULE,
        severity: "warn",
        title: `Subscriptions crept up to ${formatThb(subscriptions.monthlyTotal)} a month`,
        body: `That is ${formatThb(change)} more than the ${formatThb(subscriptions.priorAverage)} you were paying, and recurring charges never creep back down on their own. Annualised you are now committed to ${formatThb(subscriptions.annualised)} — ${formatPercentFine(subscriptions.shareOfIncome)} of everything you earn. The top ${NAMED_LINES} are ${formatPercent(concentration)} of it: ${nameLines(subscriptions.lines)}.`,
        figures: figuresFor(input),
        action: biggestLineAction(subscriptions.lines),
      }
    : {
        id: insightId(CREEP_RULE, "total"),
        rule: CREEP_RULE,
        severity: "info",
        title: `Subscriptions are steady at ${formatThb(subscriptions.monthlyTotal)} a month`,
        body: `Nothing is creeping — this matches the ${formatThb(subscriptions.priorAverage)} recent average almost exactly. Steady is not the same as free: it is ${formatThb(subscriptions.annualised)} a year, ${formatPercentFine(subscriptions.shareOfIncome)} of your income, and the top ${NAMED_LINES} lines are ${formatPercent(concentration)} of the bill — ${nameLines(subscriptions.lines)}.`,
        figures: figuresFor(input),
        action: biggestLineAction(subscriptions.lines),
      };

  return [insight];
};

const CARD_RULE = "card-due-coverage";
const CARD_SUBJECT = "cards";
const TIGHT_COVERAGE = 2;

const cardDueCoverage: Rule = (input) => {
  if (input.cards.length === 0) return [];
  if (!input.settlement) return [];

  const owed = sumBy(input.cards, (card) => card.balance);
  const settlement = input.settlement;
  const named = input.cards
    .map((card) => `${card.name} ${formatThb(card.balance)}`)
    .join(" and ");

  if (owed <= 0) {
    return [
      {
        id: insightId(CARD_RULE, CARD_SUBJECT),
        rule: CARD_RULE,
        severity: "info",
        title: "Nothing outstanding on either card",
        body: `${named} — both at zero. Cards used this way are a payment instrument, not debt, and the ledger shows no month where that slipped.`,
        figures: [
          { label: "Owed", value: formatThb(0) },
          { label: settlement.name, value: formatThb(settlement.balance) },
        ],
        action: "Keep the autopay-in-full setting that is producing this.",
      },
    ];
  }

  const coverage = settlement.balance / owed;
  const figures = [
    { label: "Owed on cards", value: formatThb(owed) },
    { label: settlement.name, value: formatThb(settlement.balance) },
    { label: "Coverage", value: formatMultiple(coverage) },
  ];

  if (coverage < 1) {
    const short = owed - settlement.balance;
    return [
      {
        id: insightId(CARD_RULE, CARD_SUBJECT),
        rule: CARD_RULE,
        severity: "crit",
        title: `Cards outrun your settlement cash by ${formatThb(short)}`,
        body: `${named} adds up to ${formatThb(owed)}, and ${settlement.name} holds ${formatThb(settlement.balance)}. The next statement cannot be cleared in full from that account, which means revolving interest — the most expensive money you will ever borrow.`,
        figures,
        action: `Free ${formatThb(short)} before the statement date, from savings if that is what it takes. Paying interest to protect a savings balance is a losing trade.`,
      },
    ];
  }

  if (coverage < TIGHT_COVERAGE) {
    return [
      {
        id: insightId(CARD_RULE, CARD_SUBJECT),
        rule: CARD_RULE,
        severity: "warn",
        title: `Card balances eat ${formatPercent(1 / coverage)} of your settlement account`,
        body: `${named} totals ${formatThb(owed)} against ${formatThb(settlement.balance)} in ${settlement.name}. It clears, but with ${formatMultiple(coverage)} cover there is no room for a surprise in the same month.`,
        figures,
        action: `Rebuild ${settlement.name} to at least ${formatThb(owed * TIGHT_COVERAGE)} so one bad month does not turn a card into a loan.`,
      },
    ];
  }

  return [
    {
      id: insightId(CARD_RULE, CARD_SUBJECT),
      rule: CARD_RULE,
      severity: "info",
      title: `Both cards clear ${formatMultiple(coverage)} over`,
      body: `${named} — ${formatThb(owed)} outstanding against ${formatThb(settlement.balance)} in ${settlement.name}. Clearing both today costs ${formatPercent(1 / coverage)} of that account. This is not a debt problem and there is no reason for it to become one.`,
      figures,
      action: `Set both cards to autopay in full from ${settlement.name} and take the decision off your desk permanently.`,
    },
  ];
};

const LOAN_RULE = "loan-progress";
const EXPENSIVE_APR = 0.06;
const MAX_CELEBRATION_AGE = 18;

const mortgageVerdict = (input: RuleInput): Insight[] => {
  const { mortgage } = input;
  if (!mortgage) return [];
  const impliedApr = impliedAprOf(mortgage.monthlyInterest, mortgage.balance);
  if (impliedApr === undefined) return [];

  const installment = mortgage.monthlyPrincipal + mortgage.monthlyInterest;
  const interestShare = mortgage.monthlyInterest / installment;
  const paidShare =
    mortgage.original > 0 ? mortgage.principalPaid / mortgage.original : 0;
  const severity = impliedApr > EXPENSIVE_APR ? "warn" : "info";

  return [
    {
      id: insightId(LOAN_RULE, mortgage.id),
      rule: LOAN_RULE,
      severity,
      title: `${formatPercent(interestShare)} of every mortgage payment is still interest`,
      body: `${formatThb(mortgage.monthlyInterest)} of your ${formatThb(installment)} installment buys nothing — it is rent on the ${formatThb(mortgage.balance)} you still owe, an implied ${formatPercentFine(impliedApr)} a year. Principal retired so far is ${formatThb(mortgage.principalPaid)} of ${formatThb(mortgage.original)}, or ${formatPercent(paidShare)}. That interest slice shrinks by only ${formatThb(mortgage.interestDeclinePerMonth)} a month on its own.`,
      figures: [
        { label: "Balance", value: formatThb(mortgage.balance) },
        { label: "Repaid", value: formatThb(mortgage.principalPaid) },
        {
          label: "Interest per month",
          value: formatThb(mortgage.monthlyInterest),
        },
        { label: "Implied rate", value: formatPercentFine(impliedApr) },
      ],
      action:
        impliedApr > EXPENSIVE_APR
          ? `At ${formatPercentFine(impliedApr)} this is expensive money — every extra baht against principal is a guaranteed return at that rate, which almost nothing else offers.`
          : `At ${formatPercentFine(impliedApr)} this is cheap debt. Overpay only if nothing else you own beats ${formatPercentFine(impliedApr)} — and look at your cash accounts before answering.`,
    },
  ];
};

const closedLoanVerdicts = (input: RuleInput): Insight[] =>
  input.closedLoans
    .filter(
      (loan) =>
        loan.monthsSinceClosed >= 1 &&
        loan.monthsSinceClosed <= MAX_CELEBRATION_AGE &&
        loan.typicalPayment > 0,
    )
    .slice(0, MAX_CLOSED_LOANS)
    .map((loan) => {
      const freed = loan.typicalPayment * loan.monthsSinceClosed;
      const redirect = input.mortgage
        ? ` ${formatThb(loan.typicalPayment)} a month at the mortgage is ${formatThb(loan.typicalPayment * 12)} a year against a balance costing you ${formatThb(input.mortgage.monthlyInterest)} a month to hold.`
        : "";
      return {
        id: insightId(LOAN_RULE, loan.id),
        rule: LOAN_RULE,
        severity: "info" as const,
        title: `${loan.name} has been gone for ${loan.monthsSinceClosed} months`,
        body: `Closed on ${formatDay(loan.closedOn)}, which freed ${formatThb(loan.typicalPayment)} a month — roughly ${formatThb(freed)} since. Money freed without a destination does not turn into savings; it turns into spending nobody remembers.`,
        figures: [
          { label: "Freed per month", value: formatThb(loan.typicalPayment) },
          { label: "Since closing", value: formatThb(freed) },
          { label: "Closed", value: formatStamp(loan.closedOn) },
        ],
        action: `Give that ${formatThb(loan.typicalPayment)} a name this month.${redirect}`,
      };
    });

const loanProgress: Rule = (input) => [
  ...mortgageVerdict(input),
  ...closedLoanVerdicts(input),
];

const FX_RULE = "fx-exposure";
const FX_SUBJECT = "usd";
const FX_HEAVY_SHARE = 0.4;
const SHOCK = 0.1;

/** Silent unless the user's own conversion legs imply a rate: the ledger stores none. */
const fxExposure: Rule = (input) => {
  if (!input.fx) return [];
  if (input.netWorthUsd <= 0) return [];

  const { rate, convertedOn, lastTransferThb } = input.fx;
  const usdInThb = input.netWorthUsd * rate;
  const total = input.netWorthThb + usdInThb;
  if (total <= 0) return [];

  const share = usdInThb / total;
  const shock = usdInThb * SHOCK;
  const severity = share > FX_HEAVY_SHARE ? "warn" : "info";
  const autopilot =
    lastTransferThb > 0
      ? ` Stop the ${formatThb(lastTransferThb)} monthly transfer running on autopilot until you have picked one.`
      : "";

  return [
    {
      id: insightId(FX_RULE, FX_SUBJECT),
      rule: FX_RULE,
      severity,
      title: `${formatPercent(share)} of your net worth sits in dollars`,
      body: `${formatUsd(input.netWorthUsd)} is ${formatThb(usdInThb)} at ${formatRate(rate)} to the dollar — the rate your own last conversion went through on ${formatDay(convertedOn)}, not a market quote. Against ${formatThb(input.netWorthThb)} of baht net worth that is ${formatPercent(share)} of a ${formatThb(total)} net worth riding on USD/THB. You earn and spend in baht, so a ${formatPercent(SHOCK)} stronger baht costs you ${formatThb(shock)} without a single holding changing.`,
      figures: [
        { label: "USD holdings", value: formatUsd(input.netWorthUsd) },
        { label: "In baht", value: formatThb(usdInThb) },
        { label: "Share of net worth", value: formatPercent(share) },
        { label: "Implied rate", value: formatRate(rate) },
      ],
      action: `${formatPercent(share)} is a position, not an accident — hold it deliberately with a target weight or trim it.${autopilot}`,
    },
  ];
};

const OUTLIER_RULE = "top-outliers";
const OUTLIER_SUBJECT = "month";
const TOP_N = 3;
const OUTLIER_HEAVY_SHARE = 0.4;

const nameOf = (line: SpendLine) => line.merchant ?? line.label;

const listPhrase = (lines: readonly SpendLine[]) => {
  const parts = lines.map(
    (line) => `${nameOf(line)} ${formatThb(line.amount)}`,
  );
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
};

const topOutliers: Rule = (input) => {
  const top = input.discretionary.slice(0, TOP_N);
  if (top.length === 0) return [];
  if (input.spendToDate <= 0) return [];

  const total = sumBy(top, (line) => line.amount);
  const share = total / input.spendToDate;
  const rest = input.spendToDate - total;
  const [biggest] = top;
  const severity = share > OUTLIER_HEAVY_SHARE ? "warn" : "info";
  const dateNote = biggest
    ? ` The largest landed on ${formatDay(biggest.date)}.`
    : "";

  return [
    {
      id: insightId(OUTLIER_RULE, OUTLIER_SUBJECT),
      rule: OUTLIER_RULE,
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

/** Exhaustive by construction: a new RuleKey will not compile until it lands here. */
const RULES = {
  "savings-rate": savingsRate,
  "category-spike": categorySpike,
  "subscription-creep": subscriptionCreep,
  "card-due-coverage": cardDueCoverage,
  "loan-progress": loanProgress,
  "fx-exposure": fxExposure,
  "top-outliers": topOutliers,
} satisfies Record<RuleKey, Rule>;

const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, info: 2 };

/** Severity first; within a severity, the rule order declared above. */
export const runInsights = (input: RuleInput): Insight[] =>
  sortBy(
    Object.values(RULES).flatMap((rule) => rule(input)),
    [(insight) => SEVERITY_RANK[insight.severity]],
  );
