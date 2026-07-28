/**
 * Calendar helpers over ISO date strings (`YYYY-MM-DD`) and month keys
 * (`YYYY-MM`). Everything runs in UTC arithmetic so a server in any timezone
 * derives the same month boundaries; only "what day is it" needs a timezone,
 * and that belongs to the ledger rather than to this app.
 */

export { isoToday } from "@openledger-fleet/openledger/calendar";

const pad = (value: number) => String(value).padStart(2, "0");

export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);
export const dayOf = (isoDate: string): number => Number(isoDate.slice(8, 10));

const yearNumber = (monthKey: string) => Number(monthKey.slice(0, 4));
const monthNumber = (monthKey: string) => Number(monthKey.slice(5, 7));

export const daysInMonth = (monthKey: string): number =>
  new Date(
    Date.UTC(yearNumber(monthKey), monthNumber(monthKey), 0),
  ).getUTCDate();

export const shiftMonth = (monthKey: string, delta: number): string => {
  const moved = new Date(
    Date.UTC(yearNumber(monthKey), monthNumber(monthKey) - 1 + delta, 1),
  );
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}`;
};

/** The `count` months before `monthKey`, oldest first. */
export const monthsBefore = (monthKey: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    shiftMonth(monthKey, index - count),
  );

export const firstDayOf = (monthKey: string): string => `${monthKey}-01`;

export const shiftDays = (isoDate: string, delta: number): string => {
  const moved = new Date(`${isoDate}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + delta);
  return moved.toISOString().slice(0, 10);
};

/** Whole calendar months from `fromIso` to `toIso`, never negative. */
export const monthsUntil = (fromIso: string, toIso: string): number => {
  const gross =
    (yearNumber(toIso) - yearNumber(fromIso)) * 12 +
    (monthNumber(toIso) - monthNumber(fromIso));
  const whole = dayOf(toIso) >= dayOf(fromIso) ? gross : gross - 1;
  return Math.max(whole, 0);
};

/**
 * A short month is missing the tail days a long one has, so a day-aligned
 * window clamps rather than reaching past the month end.
 */
export const clampDay = (monthKey: string, day: number): number =>
  Math.min(day, daysInMonth(monthKey));

export const lastDayOf = (monthKey: string): string =>
  `${monthKey}-${String(daysInMonth(monthKey)).padStart(2, "0")}`;

/** A year of history: long enough for a trailing average, short enough to still describe now. */
const WINDOW_MONTHS = 12;

/** The calendar year for annualising a monthly figure — not an observation window. */
export const MONTHS_PER_YEAR = 12;

/**
 * The trailing whole months before `asOf`'s own month, and the dates that
 * bracket them. The month `asOf` falls in is deliberately excluded: a ledger
 * read on the 10th would otherwise average a third of a month in with twelve
 * full ones. Every trailing figure in the app is measured over this.
 */
export const windowOf = (
  asOf: string,
): { from: string; to: string; months: readonly string[] } => {
  const month = monthOf(asOf);
  return {
    from: firstDayOf(shiftMonth(month, -WINDOW_MONTHS)),
    to: lastDayOf(shiftMonth(month, -1)),
    months: monthsBefore(month, WINDOW_MONTHS),
  };
};

/**
 * The same span counted through `asOf`'s own month. A column of totals is not
 * distorted by a part month the way an average is, so a chart of them runs to
 * the present rather than stopping a month short of the postings beside it.
 */
export const monthsThrough = (asOf: string): readonly string[] => {
  const month = monthOf(asOf);
  return [...monthsBefore(month, WINDOW_MONTHS - 1), month];
};
