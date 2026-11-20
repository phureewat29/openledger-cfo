import { sumBy } from "es-toolkit";

import type { SeedContext, SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
import { dayIn, onOrBeforeBusinessDay, within } from "../calendar";
import { fromUnits, toUnits } from "../money";
import { CONSULTING, EMPLOYMENT } from "../products/income";
import { leg, linked } from "../rows";

/** Thai personal income tax: each marginal rate applies only to the slice inside its band. */
const TAX_BANDS = [
  { from: 0, to: 150_000, rate: 0 },
  { from: 150_000, to: 300_000, rate: 0.05 },
  { from: 300_000, to: 500_000, rate: 0.1 },
  { from: 500_000, to: 750_000, rate: 0.15 },
  { from: 750_000, to: 1_000_000, rate: 0.2 },
  { from: 1_000_000, to: 2_000_000, rate: 0.25 },
  { from: 2_000_000, to: 5_000_000, rate: 0.3 },
  { from: 5_000_000, to: Number.POSITIVE_INFINITY, rate: 0.35 },
] as const;

const annualTax = (assessable: number): number =>
  sumBy(
    TAX_BANDS,
    (band) =>
      Math.max(0, Math.min(assessable, band.to) - band.from) * band.rate,
  );

const marginalRate = (assessable: number): number =>
  TAX_BANDS.find((band) => assessable > band.from && assessable <= band.to)
    ?.rate ?? 0.35;

/** A year past the table keeps the latest figure. */
const forYear = (table: Readonly<Record<number, number>>, year: number) =>
  table[year] ?? Object.values(table).at(-1) ?? 0;

interface Bonus {
  multiplier: number;
  label: string;
}

const PAYROLL = {
  paydayOfMonth: 25,
  grossByYear: { 2024: 320_000, 2025: 342_400, 2026: 364_656 } as Record<
    number,
    number
  >,
  socialSecurity: 750,
  providentFundRate: 0.075,
  bonusMonths: {
    4: { multiplier: 1, label: "Mid-year bonus" },
    12: { multiplier: 3, label: "Annual bonus" },
  } as Record<number, Bonus>,
} as const;

// PND1 withholding takes only these deductions; provident-fund relief is
// claimed at filing, which is why April brings a refund.
const EXPENSE_DEDUCTION = 100_000;
const PERSONAL_ALLOWANCE = 60_000;

const assessableIncome = (year: number): number =>
  forYear(PAYROLL.grossByYear, year) * 12 -
  EXPENSE_DEDUCTION -
  PERSONAL_ALLOWANCE -
  PAYROLL.socialSecurity * 12;

/** Invoiced against the flat 3% a Thai payer withholds from professional fees. */
const RETAINER = {
  paydayOfMonth: 5,
  withholdingRate: 0.03,
  byYear: { 2024: 145_000, 2025: 155_000, 2026: 165_000 } as Record<
    number,
    number
  >,
} as const;

const payslipRows = (ctx: SeedContext): SeedRow[] =>
  ctx.months.flatMap((month) => {
    const payday = onOrBeforeBusinessDay(dayIn(month, PAYROLL.paydayOfMonth));
    if (!within(payday, ctx.window)) return [];

    const assessable = assessableIncome(month.year);
    const grossUnits = toUnits(forYear(PAYROLL.grossByYear, month.year));
    const taxUnits = Math.round(toUnits(annualTax(assessable)) / 12);
    const socialUnits = toUnits(PAYROLL.socialSecurity);
    const providentUnits = Math.round(grossUnits * PAYROLL.providentFundRate);
    const netUnits = grossUnits - taxUnits - socialUnits - providentUnits;

    const payslip = linked({
      date: payday,
      description: `Payslip — ${EMPLOYMENT.payer}`,
      legs: [
        leg(EMPLOYMENT.taxAccount, EMPLOYMENT.account, fromUnits(taxUnits)),
        leg(ACCOUNT.socialSecurity, EMPLOYMENT.account, fromUnits(socialUnits)),
        leg(ACCOUNT.pvd, EMPLOYMENT.account, fromUnits(providentUnits)),
        leg(EMPLOYMENT.settlesTo, EMPLOYMENT.account, fromUnits(netUnits)),
      ],
    });

    const bonus = PAYROLL.bonusMonths[month.month];
    if (bonus === undefined) return [payslip];

    const bonusGrossUnits = Math.round(grossUnits * bonus.multiplier);
    const bonusTaxUnits = Math.round(
      bonusGrossUnits * marginalRate(assessable),
    );
    return [
      payslip,
      linked({
        date: payday,
        description: `${bonus.label} — ${EMPLOYMENT.payer}`,
        legs: [
          leg(EMPLOYMENT.taxAccount, ACCOUNT.bonus, fromUnits(bonusTaxUnits)),
          leg(
            EMPLOYMENT.settlesTo,
            ACCOUNT.bonus,
            fromUnits(bonusGrossUnits - bonusTaxUnits),
          ),
        ],
      }),
    ];
  });

const retainerRows = (ctx: SeedContext): SeedRow[] =>
  ctx.months.flatMap((month) => {
    const payday = onOrBeforeBusinessDay(dayIn(month, RETAINER.paydayOfMonth));
    if (!within(payday, ctx.window)) return [];

    const grossUnits = toUnits(forYear(RETAINER.byYear, month.year));
    const whtUnits = Math.round(grossUnits * RETAINER.withholdingRate);

    return [
      linked({
        date: payday,
        description: `Freelance — ${CONSULTING.payer}`,
        legs: [
          leg(CONSULTING.taxAccount, CONSULTING.account, fromUnits(whtUnits)),
          leg(
            CONSULTING.settlesTo,
            CONSULTING.account,
            fromUnits(grossUnits - whtUnits),
          ),
        ],
      }),
    ];
  });

export const generateIncome = (ctx: SeedContext): SeedRow[] => [
  ...payslipRows(ctx),
  ...retainerRows(ctx),
];
