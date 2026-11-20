import type { Instrument } from "./products/securities";
import { satang } from "./money";
import { ANCHOR_MONTHS } from "./products/securities";
import { createRng } from "./rng";

/** How far one month's price may stray from its place on the anchor curve. */
const JITTER = 0.015;

/**
 * Wide enough for the jitter and two-decimal rounding, narrow enough that a leg
 * priced off the wrong month cannot pass.
 */
const PRICE_BAND = 0.035;

const linear = (
  from: number,
  to: number,
  start: number,
  end: number,
  at: number,
): number => start + ((end - start) * (at - from)) / (to - from);

/** The curve itself: straight lines between the anchors, flat outside them. */
const trend = (anchors: readonly number[], monthIndex: number): number => {
  const upper = ANCHOR_MONTHS.findIndex((month) => month >= monthIndex);
  if (upper < 0) return anchors.at(-1) ?? 0;
  if (upper === 0) return anchors[0] ?? 0;
  return linear(
    ANCHOR_MONTHS[upper - 1] ?? 0,
    ANCHOR_MONTHS[upper] ?? 1,
    anchors[upper - 1] ?? 0,
    anchors[upper] ?? 0,
    monthIndex,
  );
};

/**
 * Keyed by instrument and month, not drawn from the run's generator, so any
 * reader can recompute a price, the invariants included.
 */
const wobble = (unit: string, monthIndex: number): number => {
  const seed = [...unit].reduce(
    (hash, letter) => Math.imul(hash, 31) + letter.charCodeAt(0),
    monthIndex * 2_654_435_761,
  );
  return (createRng(seed)() * 2 - 1) * JITTER;
};

export const priceOn = (instrument: Instrument, monthIndex: number): number =>
  satang(
    trend(instrument.anchors, monthIndex) *
      (1 + wobble(instrument.unit, monthIndex)),
  );

/** The persona bought in before the window, so t0 is the anchor rather than a draw. */
export const openingPriceOf = (instrument: Instrument): number =>
  instrument.anchors[0] ?? 0;

export const withinPriceBand = (implied: number, target: number): boolean =>
  target > 0 && Math.abs(implied - target) <= target * PRICE_BAND;
