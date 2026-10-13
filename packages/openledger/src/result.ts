export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const map = <T, U, E>(
  result: Result<T, E>,
  f: (value: T) => U,
): Result<U, E> => (result.ok ? ok(f(result.value)) : result);

export const mapErr = <T, E, F>(
  result: Result<T, E>,
  f: (error: E) => F,
): Result<T, F> => (result.ok ? result : err(f(result.error)));

export const andThen = <T, U, E, F>(
  result: Result<T, E>,
  f: (value: T) => Result<U, F>,
): Result<U, E | F> => (result.ok ? f(result.value) : result);

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

/** A thrown value is not always an Error; this is the one place that decides its text. */
export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
