import type { Insight, Rule, RuleInput } from "../types";
import {
  formatDay,
  formatPercent,
  formatPercentFine,
  formatStamp,
  formatThb,
} from "../../format";
import { impliedAprOf, MAX_CLOSED_LOANS } from "../../loans";
import { insightId } from "../types";

const RULE = "loan-progress";
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
      id: insightId(RULE, mortgage.id),
      rule: RULE,
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
        id: insightId(RULE, loan.id),
        rule: RULE,
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

export const loanProgress: Rule = (input) => [
  ...mortgageVerdict(input),
  ...closedLoanVerdicts(input),
];
