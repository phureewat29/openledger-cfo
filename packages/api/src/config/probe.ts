export type ProbeReason = "unauthorized" | "unreachable";

export type ProbeOutcome =
  | { ok: true }
  | { ok: false; reason: ProbeReason; message: string };

const TIMEOUT_MS = 3_500;

const UNAUTHORIZED = new Set([401, 403]);

const trimTrailingSlashes = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "");

export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const timedOut = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === "TimeoutError";

/**
 * The one probe: `GET {base}/models`, the cheapest call in the wire protocol
 * that proves the URL answers; a 404 is the classic missing-`/v1` base URL.
 * String concat on purpose — `new URL("models", base)` resolves against a
 * pathed base by dropping its last segment, which silently eats the `/v1`.
 */
export const probeModels = async (candidate: {
  baseUrl: string;
  apiKey?: string;
}): Promise<ProbeOutcome> => {
  const url = `${trimTrailingSlashes(candidate.baseUrl)}/models`;
  const fail = (reason: ProbeReason, message: string): ProbeOutcome => ({
    ok: false,
    reason,
    message,
  });

  try {
    const response = await fetch(url, {
      headers: candidate.apiKey
        ? { authorization: `Bearer ${candidate.apiKey}` }
        : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 429 still proves the route and the credential; being throttled is not down.
    if (response.ok || response.status === 429) return { ok: true };
    if (UNAUTHORIZED.has(response.status)) {
      return fail(
        "unauthorized",
        `${url} answered ${String(response.status)}.`,
      );
    }
    return fail(
      "unreachable",
      `${url} answered ${String(response.status)}${
        response.status === 404 || response.status === 405
          ? " — the base URL usually ends at the API root, e.g. /v1."
          : "."
      }`,
    );
  } catch (cause) {
    return fail(
      "unreachable",
      timedOut(cause)
        ? `No answer within ${String(TIMEOUT_MS / 1000)} seconds.`
        : messageOf(cause),
    );
  }
};
