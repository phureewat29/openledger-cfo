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

/**
 * The one place connector Results become transport errors. The demo hint is
 * opt-in: prepare can exit not_configured for an unreachable OCR endpoint,
 * which reloading the demo ledger would not fix.
 */
export const unwrapOrTrpc = <T>(
  result: Result<T, OledError>,
  opts?: { notConfiguredMessage?: string },
): T => {
  if (result.ok) return result.value;

  const { error } = result;
  if (error.kind === "not_configured" && opts?.notConfiguredMessage) {
    throw new TRPCError({
      code: ERROR_CODE.not_configured,
      message: opts.notConfiguredMessage,
    });
  }
  throw new TRPCError({
    code: ERROR_CODE[error.kind],
    message: error.hint ? `${error.message} (${error.hint})` : error.message,
  });
};

export const DEMO_HINT =
  "Demo ledger not initialized — run `pnpm bootstrap` first";
