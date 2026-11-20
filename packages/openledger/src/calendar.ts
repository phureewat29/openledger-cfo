// Only "today" needs a time zone: every other date is a date-only string in UTC arithmetic.
const LEDGER_TIME_ZONE = "Asia/Bangkok";

const ISO_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: LEDGER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Assembled from parts rather than a locale pattern, which can reorder. */
export const isoToday = (instant: Date = new Date()): string => {
  const parts = ISO_PARTS.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
