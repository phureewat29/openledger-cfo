import { sumBy } from "es-toolkit";

import type { Rule } from "../types";
import { formatMultiple, formatPercent, formatThb } from "../../format";
import { insightId } from "../types";

const RULE = "card-due-coverage";
const SUBJECT = "cards";
const TIGHT_COVERAGE = 2;

export const cardDueCoverage: Rule = (input) => {
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
        id: insightId(RULE, SUBJECT),
        rule: RULE,
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
        id: insightId(RULE, SUBJECT),
        rule: RULE,
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
        id: insightId(RULE, SUBJECT),
        rule: RULE,
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
      id: insightId(RULE, SUBJECT),
      rule: RULE,
      severity: "info",
      title: `Both cards clear ${formatMultiple(coverage)} over`,
      body: `${named} — ${formatThb(owed)} outstanding against ${formatThb(settlement.balance)} in ${settlement.name}. Clearing both today costs ${formatPercent(1 / coverage)} of that account. This is not a debt problem and there is no reason for it to become one.`,
      figures,
      action: `Set both cards to autopay in full from ${settlement.name} and take the decision off your desk permanently.`,
    },
  ];
};
