import type { BalanceSheet } from "~/ledger/accounts";

export type Severity = "info" | "warn" | "crit";

export type RuleKey =
  | "savings-rate"
  | "category-spike"
  | "subscription-creep"
  | "card-due-coverage"
  | "fx-exposure"
  | "top-outliers"
  | "loan-progress";

interface Figure {
  readonly label: string;
  readonly value: string;
}

export interface Insight {
  /** `<rule>:<subject>` — stable across reloads so acknowledgements stick. */
  readonly id: string;
  readonly rule: RuleKey;
  readonly severity: Severity;
  readonly title: string;
  readonly body: string;
  readonly figures: readonly Figure[];
  readonly action: string;
}

export interface AccountSummary {
  readonly name: string;
  readonly balance: number;
}

export interface MonthTotals {
  readonly month: string;
  readonly income: number;
  readonly expenses: number;
  readonly net: number;
}

export interface SpendLine {
  readonly date: string;
  readonly account: string;
  readonly category: string;
  /** Sanitized: statement descriptions are untrusted text. */
  readonly label: string;
  readonly merchant: string | null;
  readonly amount: number;
}

/**
 * A category over the same slice of each month: a charge that always posts on the 5th
 * lands on both sides, where a spend-per-day projection would read a fake spike.
 */
export interface CategoryWindow {
  readonly id: string;
  readonly label: string;
  readonly toDate: number;
  readonly priorToDateAvg: number;
  readonly priorMonthAvg: number;
  /** `toDate` rescaled by the category's own historical intra-month curve. */
  readonly projected: number;
  readonly topLines: readonly SpendLine[];
}

export interface RecurringLine {
  readonly merchant: string;
  readonly account: string;
  readonly amount: number;
}

export interface Subscriptions {
  readonly monthlyTotal: number;
  readonly priorAverage: number;
  readonly annualised: number;
  readonly shareOfIncome: number;
  readonly lines: readonly RecurringLine[];
}

export interface MortgageProgress {
  readonly id: string;
  readonly balance: number;
  readonly principalPaid: number;
  readonly original: number;
  readonly monthlyPrincipal: number;
  readonly monthlyInterest: number;
  /** How much the interest slice shrinks each month at the current schedule. */
  readonly interestDeclinePerMonth: number;
}

export interface ClosedLoan {
  readonly id: string;
  readonly name: string;
  readonly closedOn: string;
  readonly typicalPayment: number;
  readonly monthsSinceClosed: number;
}

interface Payday {
  readonly typicalDay: number | undefined;
  readonly landed: boolean;
  readonly incomeToDate: number;
}

export interface FxPosition {
  /** Implied by the last conversion's two legs — never a market quote. */
  readonly rate: number;
  readonly convertedOn: string;
  readonly lastTransferThb: number;
}

export interface RuleInput extends BalanceSheet {
  readonly today: string;
  /** Latest date the ledger actually has activity for. */
  readonly asOf: string;
  readonly month: string;
  readonly dayOfMonth: number;
  readonly daysInMonth: number;
  /** Complete months only, oldest first. */
  readonly months: readonly MonthTotals[];
  readonly currentMonth: MonthTotals;
  readonly spendToDate: number;
  readonly projectedSpend: number;
  readonly categories: readonly CategoryWindow[];
  readonly subscriptions: Subscriptions;
  readonly discretionary: readonly SpendLine[];
  readonly payday: Payday;
  readonly fx: FxPosition | undefined;
  readonly cash: number;
  readonly investments: number;
  readonly cards: readonly AccountSummary[];
  /** The account statements are actually settled from — highest outflow. */
  readonly settlement: AccountSummary | undefined;
  readonly mortgage: MortgageProgress | undefined;
  readonly closedLoans: readonly ClosedLoan[];
  /** Trailing-12-month interest income over cash held, as a fraction. */
  readonly cashYield: number | undefined;
}

export type Rule = (input: RuleInput) => Insight[];

export const insightId = (rule: RuleKey, subject: string): string =>
  `${rule}:${subject}`;
