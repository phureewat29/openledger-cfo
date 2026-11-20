import { sortBy } from "es-toolkit";

import type { Insight, Rule, RuleInput, RuleKey } from "./types";
import { cardDueCoverage } from "~/insights/rules/card-due-coverage";
import { categorySpike } from "~/insights/rules/category-spike";
import { fxExposure } from "~/insights/rules/fx-exposure";
import { loanProgress } from "~/insights/rules/loan-progress";
import { savingsRate } from "~/insights/rules/savings-rate";
import { subscriptionCreep } from "~/insights/rules/subscription-creep";
import { topOutliers } from "~/insights/rules/top-outliers";
import { severityRank } from "./types";

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

/** Severity first; within a severity, the rule order declared above. */
export const runInsights = (input: RuleInput): Insight[] =>
  sortBy(
    Object.values(RULES).flatMap((rule) => rule(input)),
    [(insight) => severityRank(insight.severity)],
  );
