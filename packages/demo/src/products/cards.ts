import { z } from "zod/v4";

import { accountIdSchema } from "@openledger-fleet/openledger";

import { ACCOUNT } from "../accounts";

/** The Bank of Thailand caps credit-card interest at 16% a year. */
const CARD_ANNUAL_RATE = 0.16;

export const cardSchema = z.object({
  key: z.string(),
  account: accountIdSchema,
  /** Short form used in row descriptions; `name` is what the chart calls the account. */
  label: z.string(),
  name: z.string(),
  bankName: z.string(),
  masked: z.string(),
  statementDay: z.number(),
  dueDay: z.number(),
  /** Each card settles from the bank that issued it, so money moves where a statement says it does. */
  payFrom: accountIdSchema,
  opening: z.number(),
  annualRate: z.number(),
  /** Months whose statement is only part-paid, so carried balance and interest appear at all. */
  partialPaymentMonths: z.array(z.string()),
  partialFraction: z.number(),
  /**
   * The window closes with the newest statement still owed: a statement is
   * rarely paid on the day it arrives, so most cards end mid-cycle.
   */
  finalStatementUnpaid: z.boolean(),
});

export type Card = z.infer<typeof cardSchema>;

export const CARDS: Card[] = [
  {
    key: "kbankVisa",
    account: ACCOUNT.cardKbankVisa,
    label: "KBank Visa Infinite",
    name: "KBank Visa Infinite",
    bankName: "Kasikornbank",
    masked: "****2841",
    statementDay: 20,
    dueDay: 5,
    payFrom: ACCOUNT.kbank,
    opening: 68_400,
    partialPaymentMonths: ["2025-03"],
    partialFraction: 0.6,
    annualRate: CARD_ANNUAL_RATE,
    // The one disciplined card: autopay clears every statement on its due date.
    finalStatementUnpaid: false,
  },
  {
    key: "ttbAbsolute",
    account: ACCOUNT.cardTtbAbsolute,
    label: "TTB Absolute",
    name: "TTB Absolute",
    bankName: "TMBThanachart Bank",
    masked: "****4262",
    statementDay: 25,
    dueDay: 10,
    payFrom: ACCOUNT.ttbMe,
    opening: 12_600,
    partialPaymentMonths: [],
    partialFraction: 1,
    annualRate: CARD_ANNUAL_RATE,
    finalStatementUnpaid: true,
  },
  {
    key: "scbUp",
    account: ACCOUNT.cardScbUp,
    label: "SCB UP2ME",
    name: "SCB UP2ME Platinum",
    bankName: "Siam Commercial Bank",
    masked: "****5513",
    statementDay: 15,
    dueDay: 2,
    payFrom: ACCOUNT.scb,
    opening: 31_900,
    partialPaymentMonths: ["2025-11"],
    partialFraction: 0.6,
    annualRate: CARD_ANNUAL_RATE,
    finalStatementUnpaid: true,
  },
  {
    key: "krungsriFirst",
    account: ACCOUNT.cardKrungsriFirst,
    label: "Krungsri First Choice",
    name: "Krungsri First Choice",
    bankName: "Krungsri (Bank of Ayudhya)",
    masked: "****9047",
    statementDay: 28,
    dueDay: 12,
    payFrom: ACCOUNT.kbank,
    opening: 18_200,
    partialPaymentMonths: ["2026-01"],
    partialFraction: 0.6,
    annualRate: CARD_ANNUAL_RATE,
    finalStatementUnpaid: true,
  },
];
