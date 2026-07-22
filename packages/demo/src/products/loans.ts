import { z } from "zod/v4";

import { accountIdSchema } from "@openledger-fleet/openledger";

import { ACCOUNT } from "../accounts";

const prepaymentSchema = z.object({
  /** `YYYY-MM`, matched against the installment month. */
  month: z.string(),
  day: z.number(),
  amount: z.number(),
  payFrom: accountIdSchema,
});

const loanBase = {
  key: z.string(),
  account: accountIdSchema,
  interestAccount: accountIdSchema,
  name: z.string(),
  bankName: z.string(),
  label: z.string(),
  opening: z.number(),
  paymentDay: z.number(),
  payFrom: accountIdSchema,
  category: z.enum(["mortgage", "personal"]),
};

/** Interest is charged on what is still owed, so the split moves every month. */
const amortizingLoanSchema = z.object({
  ...loanBase,
  kind: z.literal("amortizing"),
  annualRate: z.number(),
  monthlyPayment: z.number(),
  prepayments: z.array(prepaymentSchema),
});

/**
 * Thai flat-rate lending charges interest on the original principal for the
 * whole term, so every installment splits identically and settling early is the
 * only way to stop paying for money already repaid.
 */
const flatLoanSchema = z.object({
  ...loanBase,
  kind: z.literal("flat"),
  monthlyPrincipal: z.number(),
  monthlyInterest: z.number(),
  /** `YYYY-MM` of the installment that absorbs whatever principal is left. */
  finalPaymentMonth: z.string(),
  /** Contract length, and how much of it was already served before the window. */
  termMonths: z.number(),
  installmentsPaid: z.number(),
});

export const loanSchema = z.discriminatedUnion("kind", [
  amortizingLoanSchema,
  flatLoanSchema,
]);

export type AmortizingLoan = z.infer<typeof amortizingLoanSchema>;
export type FlatLoan = z.infer<typeof flatLoanSchema>;
export type Loan = z.infer<typeof loanSchema>;

/**
 * Rates are the ones these four products actually carried through 2025. Both
 * mortgages are quoted off the lender's MRR — SCB posted 6.775% and KBank 6.68%
 * at the end of 2025 — so a retention deal of MRR less about two points is what
 * a borrower with this income would be paying.
 */
export const LOANS: Loan[] = [
  {
    kind: "amortizing",
    key: "mortgageCondo",
    account: ACCOUNT.mortgageCondo,
    interestAccount: ACCOUNT.mortgageInterest,
    name: "SCB Home Loan — Life Asoke Rama 9",
    bankName: "Siam Commercial Bank",
    label: "SCB Home Loan (condo)",
    category: "mortgage",
    opening: 6_500_000,
    annualRate: 0.0485,
    monthlyPayment: 36_500,
    paymentDay: 1,
    payFrom: ACCOUNT.scb,
    prepayments: [],
  },
  {
    kind: "amortizing",
    key: "mortgageHouse",
    account: ACCOUNT.mortgageHouse,
    interestAccount: ACCOUNT.mortgageInterest,
    name: "KBank Home Loan Refinance — Khon Kaen house",
    bankName: "Kasikornbank",
    label: "KBank Home Loan (house)",
    category: "mortgage",
    opening: 660_000,
    annualRate: 0.0455,
    monthlyPayment: 13_500,
    paymentDay: 5,
    payFrom: ACCOUNT.kbank,
    // Bonus season is when a Thai borrower knocks a lump off the smaller loan;
    // these two are what let it clear inside the window.
    prepayments: [
      { month: "2024-12", day: 28, amount: 150_000, payFrom: ACCOUNT.kbank },
      { month: "2025-12", day: 28, amount: 230_000, payFrom: ACCOUNT.kbank },
    ],
  },
  {
    kind: "amortizing",
    key: "personalKtb",
    account: ACCOUNT.personalLoan,
    interestAccount: ACCOUNT.personalInterest,
    name: "Krungthai Smart Money",
    bankName: "Krungthai Bank",
    label: "Krungthai Smart Money",
    category: "personal",
    opening: 400_000,
    annualRate: 0.119,
    monthlyPayment: 18_000,
    paymentDay: 8,
    payFrom: ACCOUNT.kbank,
    prepayments: [],
  },
  {
    // ฿888,000 over five years at ฿14,800 of principal and ฿2,000 of interest a
    // month: ฿120,000 of interest on the original sum, or about 2.70% flat.
    kind: "flat",
    key: "car",
    account: ACCOUNT.carLoan,
    interestAccount: ACCOUNT.carInterest,
    name: "Krungsri New Car — Honda CR-V e:HEV",
    bankName: "Krungsri (Bank of Ayudhya)",
    label: "Krungsri New Car",
    category: "personal",
    opening: 222_000,
    monthlyPrincipal: 14_800,
    monthlyInterest: 2_000,
    paymentDay: 10,
    payFrom: ACCOUNT.kbank,
    finalPaymentMonth: "2025-11",
    termMonths: 60,
    installmentsPaid: 45,
  },
];
