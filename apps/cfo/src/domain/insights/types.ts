export type Severity = "info" | "warn" | "crit";

export type RuleKey =
  | "savings-rate"
  | "category-spike"
  | "subscription-creep"
  | "card-due-coverage"
  | "fx-exposure"
  | "top-outliers"
  | "loan-progress";

export interface Figure {
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

export type AccountKind =
  | "asset"
  | "liability"
  | "income"
  | "expense"
  | "equity";

export interface AccountSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly currency: string;
  readonly balance: number;
  readonly debitsPosted: number;
  readonly creditsPosted: number;
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
 * A category measured over the same slice of the month across periods. The
 * day-aligned window is what makes the comparison honest: a fixed charge that
 * always posts on the 5th shows up on both sides of it, where a
 * spend-per-day projection would inflate it into a fake spike.
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
  readonly name: string;
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

export interface Payday {
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

export interface RuleInput {
  readonly today: string;
  /** Latest date the ledger actually has activity for. */
  readonly asOf: string;
  readonly month: string;
  readonly dayOfMonth: number;
  readonly daysInMonth: number;
  readonly netWorthThb: number;
  readonly netWorthUsd: number;
  readonly accounts: readonly AccountSummary[];
  /** Complete months only, oldest first. */
  readonly months: readonly MonthTotals[];
  readonly currentMonth: MonthTotals;
  readonly spendToDate: number;
  readonly priorSpendToDateAvg: number;
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

const SEVERITY_RANK: Record<Severity, number> = { crit: 0, warn: 1, info: 2 };

export const severityRank = (severity: Severity): number =>
  SEVERITY_RANK[severity];
