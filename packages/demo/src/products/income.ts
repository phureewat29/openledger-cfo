import { z } from "zod/v4";

import { accountIdSchema } from "@openledger-cfo/openledger";

import { ACCOUNT } from "../accounts";
import { PERSONA } from "../persona";

export const incomeSourceSchema = z.object({
  key: z.string(),
  account: accountIdSchema,
  payer: z.string(),
  /** Where the money lands after the deductions its own payslip applies. */
  settlesTo: accountIdSchema,
  taxAccount: accountIdSchema,
});

type IncomeSource = z.infer<typeof incomeSourceSchema>;

/** Two payers on two paydays into two banks, each withheld under its own regime. */
export const INCOME_SOURCES: IncomeSource[] = [
  {
    key: "employment",
    account: ACCOUNT.salary,
    payer: PERSONA.employer,
    settlesTo: ACCOUNT.kbank,
    taxAccount: ACCOUNT.incomeTax,
  },
  {
    key: "consulting",
    account: ACCOUNT.consulting,
    payer: PERSONA.client,
    settlesTo: ACCOUNT.bbl,
    taxAccount: ACCOUNT.withholdingTax,
  },
];
