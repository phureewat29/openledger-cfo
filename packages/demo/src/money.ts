/**
 * Amounts are rounded to the satang at generation time and summed as integer
 * satang, so the expected aggregates are exact rather than float-accumulated.
 */
export const satang = (amount: number): number =>
  Math.round(amount * 100) / 100;

export const toUnits = (amount: number): number => Math.round(amount * 100);

export const fromUnits = (units: number): number => units / 100;

/** Quantities carry the precision their instrument trades in; money always two. */
export const formatQuantity = (value: number, digits: number): string =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const formatMoney = (amount: number): string =>
  formatQuantity(amount, 2);
