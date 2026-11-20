import { z } from "zod/v4";

import { accountIdSchema } from "@openledger-cfo/openledger";

import { ACCOUNT } from "../accounts";

export const bankSchema = z.object({
  key: z.string(),
  account: accountIdSchema,
  name: z.string(),
  bankName: z.string(),
  masked: z.string(),
  opening: z.number(),
  /** Posted rate, not an effective yield. */
  annualRate: z.number(),
  cadence: z.enum(["monthly", "quarterly"]),
});

export type Bank = z.infer<typeof bankSchema>;

export const BANKS: Bank[] = [
  {
    key: "kbank",
    account: ACCOUNT.kbank,
    name: "KBank Wealth Current",
    bankName: "Kasikornbank",
    masked: "****4417",
    opening: 420_000,
    annualRate: 0.0025,
    cadence: "monthly",
  },
  {
    key: "scb",
    account: ACCOUNT.scb,
    name: "SCB Bill Payment",
    bankName: "Siam Commercial Bank",
    masked: "****9082",
    opening: 180_000,
    annualRate: 0.0025,
    cadence: "monthly",
  },
  {
    key: "bbl",
    account: ACCOUNT.bbl,
    name: "Bangkok Bank Bualuang Savings",
    bankName: "Bangkok Bank",
    masked: "****6620",
    opening: 310_000,
    annualRate: 0.005,
    cadence: "monthly",
  },
  {
    key: "bay",
    account: ACCOUNT.bay,
    name: "Krungsri Emergency Fund",
    bankName: "Krungsri (Bank of Ayudhya)",
    masked: "****1174",
    opening: 1_500_000,
    annualRate: 0.0125,
    cadence: "quarterly",
  },
  {
    key: "ktb",
    account: ACCOUNT.ktb,
    name: "Krungthai Family Support",
    bankName: "Krungthai Bank",
    masked: "****3308",
    opening: 60_000,
    annualRate: 0.0025,
    cadence: "quarterly",
  },
  {
    key: "ttbMe",
    account: ACCOUNT.ttbMe,
    name: "ttb ME Save",
    bankName: "TMBThanachart Bank",
    masked: "****3155",
    opening: 950_000,
    annualRate: 0.015,
    cadence: "monthly",
  },
  {
    key: "uob",
    account: ACCOUNT.uob,
    name: "UOB Travel & FX",
    bankName: "UOB Thailand",
    masked: "****7739",
    opening: 145_000,
    annualRate: 0.005,
    cadence: "quarterly",
  },
];
