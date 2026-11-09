import { EXIT } from "@aquartier/openledger/contract";
import { z } from "zod/v4";

import type { Result } from "./result";
import { err, ok, parseJson } from "./result";

export type OledErrorKind =
  | "spawn_failed"
  | "cli_error"
  | "usage"
  | "not_configured"
  | "input_required"
  | "not_found"
  | "invalid"
  | "partial"
  | "busy"
  | "contract_mismatch"
  | "parse_failed";

export interface OledError {
  kind: OledErrorKind;
  message: string;
  hint?: string;
  exitCode?: number;
  /** Per-row result objects that failed, for the batch commands that exit 7. */
  failures?: unknown[];
}

/** oled's published exit contract; any code outside this table is a generic cli_error. */
export const EXIT_KIND: Record<number, OledErrorKind> = {
  [EXIT.GENERIC]: "cli_error",
  [EXIT.USAGE]: "usage",
  [EXIT.NOT_READY]: "not_configured",
  [EXIT.INPUT_REQUIRED]: "input_required",
  [EXIT.NOT_FOUND]: "not_found",
  [EXIT.INVALID]: "invalid",
  [EXIT.PARTIAL]: "partial",
  [EXIT.BUSY]: "busy",
};

const cliErrorLineSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    hint: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

type CliErrorLine = z.infer<typeof cliErrorLineSchema>["error"];

/** Zod's verdict as a Result, every issue folded into one message after `context`. */
export const parseAs = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  kind: OledErrorKind,
  context: string,
): Result<T, OledError> => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return err({ kind, message: `${context}: ${z.prettifyError(parsed.error)}` });
};

/** Under --json a failing command writes one JSON error object to stderr. */
export const parseCliErrorLine = (stderr: string): CliErrorLine | undefined =>
  stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => cliErrorLineSchema.safeParse(parseJson(line)).data)
    .find((parsed) => parsed !== undefined)?.error;
