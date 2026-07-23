import type { SeedContext, SeedRow } from "../types";
import { ACCOUNT } from "../accounts";
import { dayIn, onOrBeforeBusinessDay, within } from "../calendar";
import { fromUnits, toUnits } from "../money";
import {
  annualTax,
  assessableIncome,
  CONSULTING,
  marginalRate,
  monthlyGross,
  monthlyRetainer,
  PAYROLL,
  PERSONA,
} from "../persona";
import { leg, linked } from "../types";

/**
 * A payslip is one linked group: the gross credit to salary is split across
 * withholding, social security, the provident fund and whatever reaches the
 * bank, so the legs sum back to gross exactly.
 */
const payslipRows = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];

  for (const month of ctx.months) {
    const payday = onOrBeforeBusinessDay(dayIn(month, PAYROLL.paydayOfMonth));
    if (!within(payday, ctx.window)) continue;

    const assessable = assessableIncome(month.year);
    const grossUnits = toUnits(monthlyGross(month.year));
    const taxUnits = Math.round(toUnits(annualTax(assessable)) / 12);
    const socialUnits = toUnits(PAYROLL.socialSecurity);
    const providentUnits = Math.round(grossUnits * PAYROLL.providentFundRate);
    const netUnits = grossUnits - taxUnits - socialUnits - providentUnits;

    rows.push(
      linked({
        date: payday,
        description: `Payslip — ${PERSONA.employer}`,
        legs: [
          leg(ACCOUNT.incomeTax, ACCOUNT.salary, fromUnits(taxUnits)),
          leg(ACCOUNT.socialSecurity, ACCOUNT.salary, fromUnits(socialUnits)),
          leg(ACCOUNT.pvd, ACCOUNT.salary, fromUnits(providentUnits)),
          leg(ACCOUNT.kbank, ACCOUNT.salary, fromUnits(netUnits)),
        ],
      }),
    );

    const bonus = PAYROLL.bonusMonths[month.month];
    if (bonus === undefined) continue;

    // A lump rides on top of a year's earnings, so it is withheld at the rate
    // the last baht of salary already reached rather than the average one.
    const bonusGrossUnits = Math.round(grossUnits * bonus.multiplier);
    const bonusTaxUnits = Math.round(
      bonusGrossUnits * marginalRate(assessable),
    );
    rows.push(
      linked({
        date: payday,
        description: `${bonus.label} — ${PERSONA.employer}`,
        legs: [
          leg(ACCOUNT.incomeTax, ACCOUNT.bonus, fromUnits(bonusTaxUnits)),
          leg(
            ACCOUNT.kbank,
            ACCOUNT.bonus,
            fromUnits(bonusGrossUnits - bonusTaxUnits),
          ),
        ],
      }),
    );
  }

  return rows;
};

/**
 * The second stream: a fixed retainer invoiced on its own payday, taxed at the
 * flat 3% a Thai payer withholds from professional fees rather than through
 * PND1, and settled into a different bank from the salary.
 */
const retainerRows = (ctx: SeedContext): SeedRow[] => {
  const rows: SeedRow[] = [];

  for (const month of ctx.months) {
    const payday = onOrBeforeBusinessDay(
      dayIn(month, CONSULTING.paydayOfMonth),
    );
    if (!within(payday, ctx.window)) continue;

    const grossUnits = toUnits(monthlyRetainer(month.year));
    const whtUnits = Math.round(grossUnits * CONSULTING.withholdingRate);

    rows.push(
      linked({
        date: payday,
        description: `Freelance — ${PERSONA.client}`,
        legs: [
          leg(ACCOUNT.withholdingTax, ACCOUNT.consulting, fromUnits(whtUnits)),
          leg(
            ACCOUNT.bbl,
            ACCOUNT.consulting,
            fromUnits(grossUnits - whtUnits),
          ),
        ],
      }),
    );
  }

  return rows;
};

export const generateIncome = (ctx: SeedContext): SeedRow[] => [
  ...payslipRows(ctx),
  ...retainerRows(ctx),
];
