import { sumBy } from "es-toolkit";

import { satang } from "./money";

/** Every random draw in the seed flows through one generator, so a fixed seed reproduces the ledger byte for byte. */
export type Rng = () => number;

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const chance = (rng: Rng, probability: number): boolean =>
  rng() < probability;

const between = (rng: Rng, min: number, max: number): number =>
  min + rng() * (max - min);

export const int = (rng: Rng, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));

export const jitter = (rng: Rng, base: number, spread: number): number =>
  base + between(rng, -spread, spread);

export const money = (rng: Rng, min: number, max: number): number =>
  satang(between(rng, min, max));

/** Wide price ranges are lopsided in real life: most trips are small, a few are stock-ups. */
export const skewedMoney = (rng: Rng, min: number, max: number): number =>
  satang(min + (max - min) * rng() ** 2);

/**
 * Walks from the guaranteed head rather than indexing, so the non-empty tuple
 * type is proof enough that a value comes back and no dead fallback is needed.
 */
export const pick = <T>(rng: Rng, items: readonly [T, ...T[]]): T => {
  const [head, ...rest] = items;
  const target = int(rng, 0, rest.length);
  return rest.reduce(
    (chosen, item, index) => (index + 1 === target ? item : chosen),
    head,
  );
};

/**
 * Draws from a shrinking pool, so no item comes back twice — a trip buys one
 * rail pass, not three. Returns fewer than `count` only if the pool runs out.
 */
export const pickDistinct = <T>(
  rng: Rng,
  items: readonly [T, ...T[]],
  count: number,
): T[] => {
  let pool: readonly T[] = items;
  const drawn: T[] = [];
  while (drawn.length < count && pool.length > 0) {
    const index = int(rng, 0, pool.length - 1);
    drawn.push(...pool.slice(index, index + 1));
    pool = [...pool.slice(0, index), ...pool.slice(index + 1)];
  }
  return drawn;
};

export const weighted = <T>(
  rng: Rng,
  entries: readonly [readonly [T, number], ...(readonly [T, number])[]],
): T => {
  const total = sumBy(entries, ([, weight]) => weight);
  let cursor = rng() * total;
  for (const [value, weight] of entries) {
    cursor -= weight;
    if (cursor < 0) return value;
  }
  return entries[0][0];
};
