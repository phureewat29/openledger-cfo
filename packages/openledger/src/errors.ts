import { z } from "zod/v4";

export type OledErrorKind =
  | "spawn_failed"
  | "cli_error"
  | "usage"
  | "not_configured"
  | "input_required"
  | "not_found"
  | "invalid"
  | "partial"
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
  1: "cli_error",
  2: "usage",
  3: "not_configured",
  4: "input_required",
  5: "not_found",
  6: "invalid",
  7: "partial",
};

const cliErrorLineSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    hint: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type CliErrorLine = z.infer<typeof cliErrorLineSchema>["error"];

/** JSON has no `undefined`, so it doubles as the parse-failure signal. */
export const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** Under --json a failing command writes one JSON error object to stderr. */
export const parseCliErrorLine = (stderr: string): CliErrorLine | undefined => {
  for (const line of stderr.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    const parsed = cliErrorLineSchema.safeParse(safeJsonParse(trimmed));
    if (parsed.success) return parsed.data.error;
  }
  return undefined;
};
