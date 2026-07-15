/**
 * The ledger's account ids read `<currency>:<type>:<group>:<leaf>`. Reading
 * meaning out of one is a rule about the ledger's own encoding, not about any
 * single reader, so it lives beside the client every reader already depends on.
 */

/** `thb:expense:food` — deep enough to name a category, shallow enough to group its leaves. */
const CATEGORY_SEGMENTS = 3;

/** An id belongs to a prefix only at a segment boundary, not at any shared string. */
export const matchesPrefix = (id: string, prefix: string): boolean =>
  id === prefix || id.startsWith(`${prefix}:`);

/** Counterparties only mean something rolled up to their category. */
export const categoryOf = (id: string): string =>
  id.split(":").slice(0, CATEGORY_SEGMENTS).join(":");
