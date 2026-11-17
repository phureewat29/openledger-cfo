import { z } from "zod/v4";

import { messageOf } from "@openledger-cfo/openledger";

export type ProbeReason = "unauthorized" | "unreachable" | "rejected";

export type ProbeOutcome =
  { ok: true } | { ok: false; reason: ProbeReason; message: string };

const CHAT_TIMEOUT_MS = 10_000;
const PING_TIMEOUT_MS = 3_500;

const UNAUTHORIZED = new Set([401, 403]);

// OpenAI nests `{error: {message}}`; some providers flatten to `{error: string}`.
const ErrorBody = z.looseObject({
  error: z
    .union([z.string(), z.looseObject({ message: z.string() })])
    .transform((error) => (typeof error === "string" ? error : error.message)),
});

// Callers build URLs by string concat on purpose — `new URL("...", base)`
// resolves against a pathed base by dropping its last segment, which
// silently eats the `/v1`.
const trimTrailingSlashes = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/, "");

const timedOut = (cause: unknown): boolean =>
  cause instanceof Error && cause.name === "TimeoutError";

const fail = (reason: ProbeReason, message: string): ProbeOutcome => ({
  ok: false,
  reason,
  message,
});

// undici buries the useful part (ECONNREFUSED host:port) in `cause.cause`;
// its own message is just "fetch failed".
const causeOf = (cause: unknown): string => {
  const nested =
    cause instanceof Error && cause.cause instanceof Error
      ? ` — ${cause.cause.message}`
      : "";
  return `${messageOf(cause)}${nested}`;
};

const caught = (cause: unknown, timeoutMs: number): ProbeOutcome =>
  fail(
    "unreachable",
    timedOut(cause)
      ? `No answer within ${String(timeoutMs / 1000)} seconds.`
      : causeOf(cause),
  );

const answered = (url: string, status: number): string =>
  `${url} answered ${String(status)}${
    status === 404 || status === 405
      ? " — the base URL usually ends at the API root, e.g. /v1."
      : "."
  }`;

const bearer = (apiKey?: string): Record<string, string> =>
  apiKey ? { authorization: `Bearer ${apiKey}` } : {};

/**
 * The verdicts every probe shares: a 429 proves the route and the credential,
 * since throttled is not broken, and 401/403 is the key. Any other failed
 * status is the caller's to read; a throw or a timeout is unreachable.
 */
const probe = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  rejected: (response: Response) => ProbeOutcome | Promise<ProbeOutcome>,
): Promise<ProbeOutcome> => {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok || response.status === 429) return { ok: true };
    if (UNAUTHORIZED.has(response.status)) {
      return fail(
        "unauthorized",
        `${url} answered ${String(response.status)}.`,
      );
    }
    return await rejected(response);
  } catch (cause) {
    return caught(cause, timeoutMs);
  }
};

/**
 * The Test button's probe: one completion capped at a single token — the only
 * check that proves URL, key, and model together, because it is the request
 * this config exists to serve.
 */
export const probeChat = (candidate: {
  baseUrl: string;
  apiKey?: string;
  model: string;
}): Promise<ProbeOutcome> => {
  const url = `${trimTrailingSlashes(candidate.baseUrl)}/chat/completions`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...bearer(candidate.apiKey),
    },
    body: JSON.stringify({
      model: candidate.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
      temperature: 0,
    }),
  };
  // An error body is the endpoint speaking ("model not found"); a bare
  // status is the route missing.
  return probe(url, init, CHAT_TIMEOUT_MS, async (response) => {
    const body = ErrorBody.safeParse(
      await response.json().catch(() => undefined),
    );
    return body.success
      ? fail("rejected", body.data.error)
      : fail("unreachable", answered(url, response.status));
  });
};

/** The status dot's free liveness ping; the Test button runs `probeChat`. */
export const probeModels = (candidate: {
  baseUrl: string;
  apiKey?: string;
}): Promise<ProbeOutcome> => {
  const url = `${trimTrailingSlashes(candidate.baseUrl)}/models`;
  return probe(
    url,
    { headers: bearer(candidate.apiKey) },
    PING_TIMEOUT_MS,
    (response) => fail("unreachable", answered(url, response.status)),
  );
};
