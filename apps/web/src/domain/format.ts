import type { UnitPosition } from "./portfolio";

const thb = (options: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    ...options,
  });

const usd = (options: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    ...options,
  });

const WHOLE = { minimumFractionDigits: 0, maximumFractionDigits: 0 } as const;

const THB_WHOLE = thb(WHOLE);
const THB_SIGNED = thb({ ...WHOLE, signDisplay: "exceptZero" });
const COMPACT = { notation: "compact", maximumFractionDigits: 1 } as const;
const THB_COMPACT = thb(COMPACT);
const THB_COMPACT_SIGNED = thb({ ...COMPACT, signDisplay: "exceptZero" });
const USD_WHOLE = usd(WHOLE);
const USD_COMPACT = usd(COMPACT);

const PERCENT = new Intl.NumberFormat("th-TH", {
  style: "percent",
  maximumFractionDigits: 0,
});
const PERCENT_FINE = new Intl.NumberFormat("th-TH", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatThb = (amount: number): string => THB_WHOLE.format(amount);
export const formatThbSigned = (amount: number): string =>
  THB_SIGNED.format(amount);
export const formatThbCompact = (amount: number): string =>
  THB_COMPACT.format(amount);
export const formatThbCompactSigned = (amount: number): string =>
  THB_COMPACT_SIGNED.format(amount);
export const formatUsd = (amount: number): string => USD_WHOLE.format(amount);

/** A chart axis has room for the shape of a figure, not its digits. */
const COMPACT_MONEY: Record<string, (amount: number) => string> = {
  THB: formatThbCompact,
  USD: (amount) => USD_COMPACT.format(amount),
};

export const compactOf = (currency: string): ((amount: number) => string) =>
  COMPACT_MONEY[currency.toUpperCase()] ?? formatThbCompact;

/** Each account carries its own currency; the ledger only ever holds these two. */
const MONEY: Record<string, (amount: number) => string> = {
  THB: formatThb,
  USD: formatUsd,
};

export const moneyOf = (currency: string): ((amount: number) => string) =>
  MONEY[currency.toUpperCase()] ?? formatThb;

/** Past this a price's decimals are noise; below it they are most of the figure. */
const PRICE_DECIMALS_BELOW = 1_000;
const CENTS = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const THB_PRICE = thb(CENTS);
const USD_PRICE = usd(CENTS);

/** A price wants decimals a balance does not: $229.62 is a different figure from $230. */
const formatThbPrice = (price: number): string =>
  (price < PRICE_DECIMALS_BELOW ? THB_PRICE : THB_WHOLE).format(price);
const formatUsdPrice = (price: number): string =>
  (price < PRICE_DECIMALS_BELOW ? USD_PRICE : USD_WHOLE).format(price);

const PRICE: Record<string, (price: number) => string> = {
  THB: formatThbPrice,
  USD: formatUsdPrice,
};

export const priceOf = (currency: string): ((price: number) => string) =>
  PRICE[currency.toUpperCase()] ?? formatThbPrice;

/**
 * A quantity reads to two places until it is smaller than one, where two places
 * would round a whole coin away.
 */
export const formatQuantity = (quantity: number): string =>
  quantity.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: quantity < 1 ? 5 : 2,
  });

export const formatHeld = (
  position: UnitPosition | undefined,
  unitWord: string,
): string =>
  position === undefined
    ? "—"
    : `${formatQuantity(position.quantity)}${unitWord === "" ? "" : ` ${unitWord}`}`;

const ORDINAL: Record<number, string> = {
  1: "st",
  2: "nd",
  3: "rd",
  21: "st",
  22: "nd",
  23: "rd",
  31: "st",
};

export const ordinalDay = (day: number): string =>
  `${day}${ORDINAL[day] ?? "th"}`;

/** Ratios arrive as fractions (0.481), not points. */
export const formatPercent = (ratio: number): string => PERCENT.format(ratio);
export const formatPercentFine = (ratio: number): string =>
  PERCENT_FINE.format(ratio);

export const formatMultiple = (times: number): string =>
  `${times < 10 ? times.toFixed(1) : Math.round(times)}×`;

/** Runway and every other "how many months" figure. */
export const formatMonths = (months: number): string =>
  `${months.toFixed(1)} months`;

/**
 * An exchange rate in baht per foreign unit. The ledger stores no rate, so the
 * one figure the app ever quotes is spelled in exactly one place.
 */
export const formatRate = (rate: number): string => `฿${rate.toFixed(2)}`;

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
/** en-US, not en-GB: en-GB abbreviates September to 4 letters, breaking a fixed-width date column. */
const DAY_LABEL = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const DAY_STAMP = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_MONTH = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

const MONTH_ABBR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const MONTH_ABBR_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

const utc = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);
const utcMonth = (monthKey: string) => new Date(`${monthKey}-01T00:00:00Z`);

/** Pulls day/month/year back out in that order, undoing en-US's own layout. */
const dayFirst = (formatter: Intl.DateTimeFormat, date: Date): string => {
  const parts = formatter.formatToParts(date);
  const at = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return [at("day"), at("month"), at("year")].filter(Boolean).join(" ");
};

export const formatMonth = (monthKey: string): string =>
  MONTH_LABEL.format(utcMonth(monthKey));

/** A chart axis tick inside a single year of data. */
export const formatMonthAbbr = (monthKey: string): string =>
  MONTH_ABBR.format(utcMonth(monthKey)).toUpperCase();

/** The same tick where the window crosses a year. */
export const formatMonthYear = (monthKey: string): string =>
  MONTH_ABBR_YEAR.format(utcMonth(monthKey)).toUpperCase();

/** A date inside a sentence, where caps would be a shout. */
export const formatDay = (isoDate: string): string =>
  dayFirst(DAY_LABEL, utc(isoDate));

export const formatStamp = (isoDate: string): string =>
  dayFirst(DAY_STAMP, utc(isoDate)).toUpperCase();

export const formatDayMonth = (isoDate: string): string =>
  dayFirst(DAY_MONTH, utc(isoDate)).toUpperCase();

/** Segments whose title-cased form reads wrong. */
const SEGMENT_LABELS: Record<string, string> = {
  "credit-card": "Credit card",
  donation: "Donations",
  entertainment: "Entertainment",
  fees: "Bank fees",
  family: "Family support",
  food: "Food & dining",
  interest: "Loan interest",
  subscriptions: "Subscriptions",
  tax: "Tax & social security",
  "bts-mrt": "BTS / MRT",
  "condo-fee": "Condo fee",
  "income-tax": "Income tax",
  "kbank-visa": "KBank Visa",
  "real-estate": "Real estate",
  "social-security": "Social security",
  credit_card: "Credit cards",
  etf: "ETFs",
  fx: "FX",
  kbank: "KBank",
  pvd: "Provident fund",
  rmf: "RMF",
  rsu: "RSUs",
  scb: "SCB",
  ssf: "SSF",
  truemoney: "TrueMoney",
  ttb: "ttb",
  uob: "UOB",
};

const titleCase = (segment: string) =>
  segment
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * The ledger already names every account, so a caller with the row in hand
 * should pass it; the table only rescues ids read straight off a transaction.
 */
export const accountLabel = (
  accountId: string,
  name?: string | null,
): string => {
  if (name && name.length > 0) return name;
  const segment = accountId.slice(accountId.lastIndexOf(":") + 1);
  return SEGMENT_LABELS[segment] ?? titleCase(segment);
};

export const countNoun = (
  count: number,
  one: string,
  many = `${one}s`,
): string => `${String(count)} ${count === 1 ? one : many}`;
