import type { Month } from "../calendar";
import type { Merchant } from "../merchants";
import type { Rng } from "../rng";
import type { SeedContext, SeedRow } from "../rows";
import { ACCOUNT } from "../accounts";
import { dayIn, within } from "../calendar";
import { MERCHANT } from "../merchants";
import { chance, money, pick } from "../rng";
import { row } from "../rows";

const AIRCON_MONTHS = [3, 4, 5];

const TAX_REFUND_MONTH = 4;

const ALLOWANCE_DAYS = [7, 14, 21, 28];
const WEEKLY_ALLOWANCE = 5_500;

interface Bill {
  day: number;
  account: string;
  description: string;
  amount: (rng: Rng, month: Month) => number;
  from: string;
  merchant?: Merchant;
}

const MONTHLY_BILLS: Bill[] = [
  {
    day: 8,
    account: ACCOUNT.electricity,
    description: "Electricity bill",
    amount: (rng, month) =>
      AIRCON_MONTHS.includes(month.month)
        ? money(rng, 7_800, 12_400)
        : money(rng, 4_200, 6_900),
    from: ACCOUNT.scb,
    merchant: MERCHANT.mea,
  },
  {
    day: 8,
    account: ACCOUNT.water,
    description: "Water bill",
    amount: (rng) => money(rng, 280, 620),
    from: ACCOUNT.scb,
    merchant: MERCHANT.mwa,
  },
  {
    day: 17,
    account: ACCOUNT.internet,
    description: "Home internet",
    amount: () => 1_299,
    from: ACCOUNT.scb,
    merchant: MERCHANT.aisFibre,
  },
  {
    day: 19,
    account: ACCOUNT.mobile,
    description: "Mobile postpaid",
    amount: () => 1_199,
    from: ACCOUNT.scb,
    merchant: MERCHANT.aisMobile,
  },
  {
    day: 5,
    account: ACCOUNT.condoFee,
    description: "Condo common fee",
    amount: () => 6_500,
    from: ACCOUNT.scb,
  },
  {
    day: 12,
    account: ACCOUNT.houseUpkeep,
    description: "House upkeep — Khon Kaen",
    amount: (rng) => money(rng, 2_000, 4_500),
    from: ACCOUNT.scb,
  },
  {
    day: 2,
    account: ACCOUNT.parking,
    description: "Monthly car park rental",
    amount: () => 4_500,
    from: ACCOUNT.scb,
  },
  {
    day: 15,
    account: ACCOUNT.housekeeper,
    description: "Housekeeper social security contribution",
    amount: () => 750,
    from: ACCOUNT.scb,
  },
  {
    day: 22,
    account: ACCOUNT.lifeInsurance,
    description: "Life insurance premium",
    amount: () => 2_000,
    from: ACCOUNT.scb,
    merchant: MERCHANT.muangThaiLife,
  },
  {
    day: 24,
    account: ACCOUNT.streaming,
    description: "Satellite TV package",
    amount: () => 890,
    from: ACCOUNT.scb,
  },
  {
    day: 10,
    account: ACCOUNT.familyUtilities,
    description: "Parents' household bills",
    amount: (rng) => money(rng, 1_800, 3_400),
    from: ACCOUNT.ktb,
  },
  {
    day: 6,
    account: ACCOUNT.houseUpkeep,
    description: "Village fee — Khon Kaen",
    amount: () => 2_500,
    from: ACCOUNT.scb,
  },
  {
    day: 9,
    account: ACCOUNT.electricity,
    description: "Electricity bill — Khon Kaen house",
    amount: (rng, month) =>
      AIRCON_MONTHS.includes(month.month)
        ? money(rng, 5_200, 8_100)
        : money(rng, 2_900, 5_400),
    from: ACCOUNT.scb,
    merchant: MERCHANT.mea,
  },
  {
    day: 9,
    account: ACCOUNT.water,
    description: "Water bill — Khon Kaen house",
    amount: (rng) => money(rng, 320, 680),
    from: ACCOUNT.scb,
    merchant: MERCHANT.mwa,
  },
  {
    day: 18,
    account: ACCOUNT.internet,
    description: "House internet",
    amount: () => 1_099,
    from: ACCOUNT.scb,
    merchant: MERCHANT.aisFibre,
  },
  {
    day: 20,
    account: ACCOUNT.mobile,
    description: "Mobile postpaid — second line",
    amount: () => 799,
    from: ACCOUNT.scb,
    merchant: MERCHANT.aisMobile,
  },
  {
    day: 1,
    account: ACCOUNT.housekeeper,
    description: "Housekeeper — monthly",
    amount: () => 12_000,
    from: ACCOUNT.scb,
    merchant: MERCHANT.baanDee,
  },
  {
    day: 3,
    account: ACCOUNT.gardening,
    description: "Garden and pool service",
    amount: () => 3_500,
    from: ACCOUNT.scb,
    merchant: MERCHANT.poolCare,
  },
  {
    day: 7,
    account: ACCOUNT.laundry,
    description: "Laundry and pressing",
    amount: () => 2_500,
    from: ACCOUNT.scb,
    merchant: MERCHANT.laundryBar,
  },
];

interface AnnualBill extends Bill {
  month: number;
}

const ANNUAL_BILLS: AnnualBill[] = [
  {
    month: 2,
    day: 9,
    account: ACCOUNT.condoInsurance,
    description: "Property insurance premium",
    amount: () => 12_000,
    from: ACCOUNT.scb,
    merchant: MERCHANT.sriAyudhyaGeneral,
  },
  {
    month: 3,
    day: 11,
    account: ACCOUNT.dental,
    description: "Dental — scale and polish",
    amount: (rng) => money(rng, 3_500, 7_500),
    from: ACCOUNT.scb,
    merchant: MERCHANT.bangkokSmile,
  },
  {
    month: 3,
    day: 22,
    account: ACCOUNT.carInsurance,
    description: "Class 1 — Honda CR-V",
    amount: () => 16_800,
    from: ACCOUNT.scb,
    merchant: MERCHANT.dhipaya,
  },
  {
    month: 5,
    day: 16,
    account: ACCOUNT.healthInsurance,
    description: "Health insurance premium",
    amount: () => 45_000,
    from: ACCOUNT.scb,
    merchant: MERCHANT.aia,
  },
  {
    month: 7,
    day: 3,
    account: ACCOUNT.bankFees,
    description: "KBank wealth account fee",
    amount: () => 1_200,
    from: ACCOUNT.kbank,
  },
  {
    month: 8,
    day: 14,
    account: ACCOUNT.carInsurance,
    description: "Class 1 — Honda City, Khon Kaen",
    amount: () => 11_400,
    from: ACCOUNT.scb,
    merchant: MERCHANT.viriyah,
  },
  {
    month: 9,
    day: 11,
    account: ACCOUNT.dental,
    description: "Dental — scale and polish",
    amount: (rng) => money(rng, 3_500, 7_500),
    from: ACCOUNT.scb,
    merchant: MERCHANT.bangkokSmile,
  },
  {
    month: 10,
    day: 9,
    account: ACCOUNT.clinic,
    description: "Annual health check-up",
    amount: () => 12_500,
    from: ACCOUNT.scb,
    merchant: MERCHANT.samitivej,
  },
];

const DONATION_CAUSES = [
  "Temple merit — Wat Saket",
  "Donation — Thai Red Cross",
  "Donation — Soi Dog Foundation",
  "Temple merit — Wat Pho",
  "Donation — Mirror Foundation",
] as const;

const MAINTENANCE_JOBS = [
  "aircon service",
  "plumbing repair",
  "water heater replacement",
  "repainting the balcony",
  "door lock replacement",
] as const;

interface Drawdown {
  date: string;
  account: string;
  description: string;
  amount: number;
  merchant?: Merchant;
}

const EMERGENCY_DRAWS: Drawdown[] = [
  {
    date: "2025-08-20",
    account: ACCOUNT.clinic,
    description: "Hospital — inpatient admission",
    amount: 48_000,
    merchant: MERCHANT.bumrungrad,
  },
  {
    date: "2026-02-18",
    account: ACCOUNT.maintenance,
    description: "Condo aircon replacement — four units",
    amount: 98_000,
    merchant: MERCHANT.homePro,
  },
];

/** Thai tax years are Buddhist Era. */
const buddhistYear = (year: number): number => year + 542;

const billRow = (ctx: SeedContext, month: Month, bill: Bill): SeedRow[] => {
  const date = dayIn(month, bill.day);
  if (!within(date, ctx.window)) return [];
  return [
    row({
      date,
      description: bill.description,
      debit: bill.account,
      credit: bill.from,
      amount: bill.amount(ctx.rng, month),
      merchant: bill.merchant,
    }),
  ];
};

const monthRows = (ctx: SeedContext, month: Month): SeedRow[] => {
  const medicalDate = dayIn(month, 14);
  const donationDate = dayIn(month, 21);
  const jobDate = dayIn(month, 24);
  const refundDate = dayIn(month, 24);

  // Spread elements run in order, and each section draws from the rng in the
  // order the dataset was authored with.
  return [
    ...MONTHLY_BILLS.flatMap((bill) => billRow(ctx, month, bill)),
    ...ANNUAL_BILLS.filter((bill) => bill.month === month.month).flatMap(
      (bill) => billRow(ctx, month, bill),
    ),

    ...ALLOWANCE_DAYS.map((day) => dayIn(month, day))
      .filter((date) => within(date, ctx.window))
      .map((date) =>
        row({
          date,
          description: "Allowance — parents",
          debit: ACCOUNT.allowance,
          credit: ACCOUNT.ktb,
          amount: WEEKLY_ALLOWANCE,
        }),
      ),

    ...(within(medicalDate, ctx.window) && chance(ctx.rng, 0.35)
      ? [
          row({
            date: medicalDate,
            description: "Parents — clinic and medication",
            debit: ACCOUNT.familyMedical,
            credit: ACCOUNT.ktb,
            amount: money(ctx.rng, 1_500, 9_000),
          }),
        ]
      : []),

    ...(within(donationDate, ctx.window)
      ? [
          row({
            date: donationDate,
            description: pick(ctx.rng, DONATION_CAUSES),
            debit: ACCOUNT.donation,
            credit: chance(ctx.rng, 0.5) ? ACCOUNT.cash : ACCOUNT.kbank,
            amount: money(ctx.rng, 500, 3_000),
          }),
        ]
      : []),

    ...(within(jobDate, ctx.window) && chance(ctx.rng, 0.25)
      ? [
          row({
            date: jobDate,
            description: `Condo maintenance — ${pick(ctx.rng, MAINTENANCE_JOBS)}`,
            debit: ACCOUNT.maintenance,
            credit: ACCOUNT.scb,
            amount: money(ctx.rng, 1_500, 11_000),
            merchant: MERCHANT.homePro,
          }),
        ]
      : []),

    ...(month.month === TAX_REFUND_MONTH && within(refundDate, ctx.window)
      ? [
          row({
            date: refundDate,
            // A refund reverses withholding, so it credits the tax expense rather than income.
            description: `Tax refund ${String(buddhistYear(month.year - 1))}`,
            debit: ACCOUNT.kbank,
            credit: ACCOUNT.incomeTax,
            amount: money(ctx.rng, 70_000, 95_000),
          }),
        ]
      : []),
  ];
};

export const generateHousehold = (ctx: SeedContext): SeedRow[] => [
  ...ctx.months.flatMap((month) => monthRows(ctx, month)),
  ...EMERGENCY_DRAWS.filter((draw) => within(draw.date, ctx.window)).map(
    (draw) =>
      row({
        date: draw.date,
        description: draw.description,
        debit: draw.account,
        credit: ACCOUNT.bay,
        amount: draw.amount,
        merchant: draw.merchant,
      }),
  ),
];
