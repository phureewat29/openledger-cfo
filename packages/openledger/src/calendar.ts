/**
 * What day it is, for a ledger that belongs to a th-TH household. Every other
 * date in the system is a date-only string handled with UTC arithmetic; only
 * "today" needs a timezone, and the household's is the one that decides which
 * calendar day a posting or a completed chore falls on.
 */
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
