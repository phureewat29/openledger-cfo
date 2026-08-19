import { TRPCError } from "@trpc/server";

import type {
  OledError,
  OledErrorKind,
  Result,
} from "@openledger-cfo/openledger";

const ERROR_CODE: Record<OledErrorKind, TRPCError["code"]> = {
  not_configured: "PRECONDITION_FAILED",
  not_found: "NOT_FOUND",
  usage: "BAD_REQUEST",
  invalid: "BAD_REQUEST",
  input_required: "BAD_REQUEST",
  partial: "CONFLICT",
  spawn_failed: "INTERNAL_SERVER_ERROR",
  cli_error: "INTERNAL_SERVER_ERROR",
  parse_failed: "INTERNAL_SERVER_ERROR",
};

/** The one place connector Results become transport errors. */
export const unwrapOrTrpc = <T>(result: Result<T, OledError>): T => {
  if (result.ok) return result.value;

  const { error } = result;
  throw new TRPCError({
    code: ERROR_CODE[error.kind],
    message: error.hint ? `${error.message} (${error.hint})` : error.message,
    cause: error,
  });
};

const isOledError = (value: unknown): value is OledError =>
  typeof value === "object" &&
  value !== null &&
  Object.hasOwn(ERROR_CODE, (value as { kind?: string }).kind ?? "");

/**
 * The connector error back off a thrown transport error, for callers that
 * need a finer split than the code — a missing binary and a crashed CLI both
 * ride INTERNAL_SERVER_ERROR. The code table stays the one authority.
 */
export const oledCauseOf = (error: unknown): OledError | undefined =>
  error instanceof TRPCError && isOledError(error.cause)
    ? error.cause
    : undefined;
