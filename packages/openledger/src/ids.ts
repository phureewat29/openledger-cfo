// Behind the browser-safe `/ids` subpath, so this file imports nothing.

/** `<3-letter currency>:<type>[:<segment>...]`, e.g. thb:asset:bank:kbank. */
export const ACCOUNT_ID_PATTERN =
  /^[a-z]{3}:(asset|liability|income|expense|equity)(:[a-z0-9][a-z0-9._-]*)*$/;

/** `sf-<uuid>`: what `ingest prepare` returns and every later ingest step takes. */
export const FILE_ID_PATTERN =
  /^sf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `thb:expense:food` — deep enough to name a category, shallow enough to group its leaves. */
const CATEGORY_SEGMENTS = 3;

export const currencyPrefix = (accountId: string): string =>
  accountId.slice(0, 3);

/** An id belongs to a prefix only at a segment boundary, not at any shared string. */
export const matchesPrefix = (id: string, prefix: string): boolean =>
  id === prefix || id.startsWith(`${prefix}:`);

/** Counterparties only mean something rolled up to their category. */
export const categoryOf = (id: string): string =>
  id.split(":").slice(0, CATEGORY_SEGMENTS).join(":");
