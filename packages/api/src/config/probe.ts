import { z } from "zod/v4";

export type ProbeReason = "unauthorized" | "unreachable" | "rejected";

export type ProbeOutcome =
  | { ok: true }
  | { ok: false; reason: ProbeReason; message: string };

export type ProbeKind = "gateway" | "ocr";

const CHAT_TIMEOUT_MS = 10_000;
const PING_TIMEOUT_MS = 3_500;

const UNAUTHORIZED = new Set([401, 403]);

/** 64×64 white PNG: tiny to embed, yet above the minimum-size image validation some providers run (a 1×1 false-reds Venice). */
const PROBE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAAAAACPAi4CAAAAKUlEQVR4nO3MQREAAAwCIPuX1hD77SAA6VEEAoFAIBAIBAKBQCAQfA8Gpwvw4pr3blgAAAAASUVORK5CYII=";

/** Each kind speaks the request its config will serve in production. */
const MESSAGES: Record<ProbeKind, unknown> = {
  gateway: [{ role: "user", content: "ping" }],
  ocr: [
    {
      role: "user",
      content: [
        { type: "text", text: "." },
        { type: "image_url", image_url: { url: PROBE_IMAGE } },
      ],
    },
  ],
};

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
  if (!(cause instanceof Error)) return String(cause);
  const nested =
    cause.cause instanceof Error ? ` — ${cause.cause.message}` : "";
  return `${cause.message}${nested}`;
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

/**
 * The Test button's probe: one completion capped at a single token — the only
 * check that proves URL, key, and model together, because it is the request
 * this config exists to serve.
 */
export const probeChat = async (candidate: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  kind: ProbeKind;
}): Promise<ProbeOutcome> => {
  const url = `${trimTrailingSlashes(candidate.baseUrl)}/chat/completions`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(candidate.apiKey
          ? { authorization: `Bearer ${candidate.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: candidate.model,
        messages: MESSAGES[candidate.kind],
        max_tokens: 1,
        stream: false,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    // 429 proves the route and the credential; throttled is not broken.
    if (response.ok || response.status === 429) return { ok: true };
    if (UNAUTHORIZED.has(response.status)) {
      return fail(
        "unauthorized",
        `${url} answered ${String(response.status)}.`,
      );
    }
    // An error body is the endpoint speaking ("model not found"); a bare
    // status is the route missing.
    const body = ErrorBody.safeParse(
      await response.json().catch(() => undefined),
    );
    return body.success
      ? fail("rejected", body.data.error)
      : fail("unreachable", answered(url, response.status));
  } catch (cause) {
    return caught(cause, CHAT_TIMEOUT_MS);
  }
};

/** The status dot's free liveness ping; the Test button runs `probeChat`. */
export const probeModels = async (candidate: {
  baseUrl: string;
  apiKey?: string;
}): Promise<ProbeOutcome> => {
  const url = `${trimTrailingSlashes(candidate.baseUrl)}/models`;
  try {
    const response = await fetch(url, {
      headers: candidate.apiKey
        ? { authorization: `Bearer ${candidate.apiKey}` }
        : {},
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (response.ok || response.status === 429) return { ok: true };
    return UNAUTHORIZED.has(response.status)
      ? fail("unauthorized", `${url} answered ${String(response.status)}.`)
      : fail("unreachable", answered(url, response.status));
  } catch (cause) {
    return caught(cause, PING_TIMEOUT_MS);
  }
};
