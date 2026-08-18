import type { Rule } from "../types";
import {
  formatDay,
  formatPercent,
  formatRate,
  formatThb,
  formatUsd,
} from "../../format";
import { insightId } from "../types";

const RULE = "fx-exposure";
const SUBJECT = "usd";
const HEAVY_SHARE = 0.4;
const SHOCK = 0.1;

/**
 * The ledger stores no exchange rate, so this rule stays silent unless the
 * user's own conversion legs imply one. A guessed rate would put a number on
 * the page that the ledger cannot defend.
 */
export const fxExposure: Rule = (input) => {
  if (!input.fx) return [];
  if (input.netWorthUsd <= 0) return [];

  const { rate, convertedOn, lastTransferThb } = input.fx;
  const usdInThb = input.netWorthUsd * rate;
  const total = input.netWorthThb + usdInThb;
  if (total <= 0) return [];

  const share = usdInThb / total;
  const shock = usdInThb * SHOCK;
  const severity = share > HEAVY_SHARE ? "warn" : "info";
  const autopilot =
    lastTransferThb > 0
      ? ` Stop the ${formatThb(lastTransferThb)} monthly transfer running on autopilot until you have picked one.`
      : "";

  return [
    {
      id: insightId(RULE, SUBJECT),
      rule: RULE,
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
