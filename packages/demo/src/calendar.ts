import { range } from "es-toolkit";

export interface DateWindow {
  start: string;
  end: string;
}

export interface Month {
  year: number;
  /** 1-12, matching how humans write dates rather than Date's 0-11. */
  month: number;
}

const asUtc = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const pad = (value: number): string => String(value).padStart(2, "0");

const isoDate = (year: number, month: number, day: number): string =>
  `${String(year)}-${pad(month)}-${pad(day)}`;

const daysInMonth = ({ year, month }: Month): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const dayIn = (month: Month, day: number): string =>
  isoDate(month.year, month.month, Math.min(day, daysInMonth(month)));

export const lastDayIn = (month: Month): string => dayIn(month, 31);

export const addDays = (iso: string, days: number): string => {
  const date = asUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const weekday = (iso: string): number => asUtc(iso).getUTCDay();

export const isWeekend = (iso: string): boolean =>
  weekday(iso) === 0 || weekday(iso) === 6;

/** Payday lands early when it falls on a weekend; bills land late. */
export const onOrBeforeBusinessDay = (iso: string): string =>
  isWeekend(iso) ? onOrBeforeBusinessDay(addDays(iso, -1)) : iso;

export const onOrAfterBusinessDay = (iso: string): string =>
  isWeekend(iso) ? onOrAfterBusinessDay(addDays(iso, 1)) : iso;

export const addMonths = ({ year, month }: Month, count: number): Month => {
  const ordinal = year * 12 + (month - 1) + count;
  return { year: Math.floor(ordinal / 12), month: (ordinal % 12) + 1 };
};

const monthOf = (iso: string): Month => ({
  year: Number(iso.slice(0, 4)),
  month: Number(iso.slice(5, 7)),
});

export const monthKey = (iso: string): string => iso.slice(0, 7);

export const within = (iso: string, window: DateWindow): boolean =>
  iso >= window.start && iso <= window.end;

/** Whole months since the window opened — the key every price table is read by. */
export const monthIndexOf = (iso: string, window: DateWindow): number =>
  (Number(iso.slice(0, 4)) - Number(window.start.slice(0, 4))) * 12 +
  (Number(iso.slice(5, 7)) - Number(window.start.slice(5, 7)));

export const eachMonth = (window: DateWindow): Month[] => {
  const first = monthOf(window.start);
  const last = monthOf(window.end);
  const count = (last.year - first.year) * 12 + last.month - first.month + 1;
  return range(Math.max(count, 0)).map((offset) => addMonths(first, offset));
};

export const eachDay = (window: DateWindow): string[] => {
  const count =
    (asUtc(window.end).getTime() - asUtc(window.start).getTime()) / 86_400_000 +
    1;
  return range(Math.max(count, 0)).map((offset) =>
    addDays(window.start, offset),
  );
};
