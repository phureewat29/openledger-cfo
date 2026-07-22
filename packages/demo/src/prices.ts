import type { Instrument } from "./products/securities";
import { satang } from "./money";
import { createRng } from "./rng";

/** Where each anchor sits in the window's month list. */
const ANCHOR_MONTHS = [0, 3, 7, 11, 15, 23] as const;

/** How far one month's price may stray from its place on the anchor curve. */
const JITTER = 0.015;

/**
 * What an implied price may differ from the table by. Wide enough to cover the
 * jitter and the rounding of a two-decimal quantity into a two-decimal cost,
 * narrow enough that a leg priced off the wrong month cannot slip through.
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
 * Keyed by instrument and month rather than drawn from the run's own generator,
 * so a price is a fact about a month that any reader can recompute — including
 * the invariants, which never see the stream of draws that built the rows.
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
