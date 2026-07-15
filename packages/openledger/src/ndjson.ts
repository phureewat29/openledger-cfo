import { isPlainObject } from "es-toolkit";
import { z } from "zod/v4";

import type { OledError } from "./errors";
import type { Result } from "./result";
import { safeJsonParse } from "./errors";
import { err, ok } from "./result";

const PREVIEW = 200;

const parseFailed = (message: string): OledError => ({
  kind: "parse_failed",
  message,
});

const preview = (line: string): string =>
  line.length <= PREVIEW ? line : `${line.slice(0, PREVIEW)}…`;

const isSummary = (value: unknown): boolean =>
  isPlainObject(value) && value.type === "summary";

const nonEmptyLines = (stdout: string): string[] =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

export interface NdjsonPage<TRow, TSummary> {
  rows: TRow[];
  summary: TSummary | undefined;
}

/**
 * Lists emit bare row objects followed by one `{"type":"summary"}` row.
 * Commands that emit a single object and no summary yield one row and no summary.
 */
export const parseNdjsonRows = <TRow, TSummary = unknown>(
  rowSchema: z.ZodType<TRow>,
  stdout: string,
  summarySchema?: z.ZodType<TSummary>,
): Result<NdjsonPage<TRow, TSummary>, OledError> => {
  const rows: TRow[] = [];
  let summary: TSummary | undefined;

  for (const line of nonEmptyLines(stdout)) {
    const value = safeJsonParse(line);
    if (value === undefined) {
      return err(parseFailed(`Expected NDJSON, got: ${preview(line)}`));
    }

    if (isSummary(value)) {
      if (!summarySchema) continue;
      const parsedSummary = summarySchema.safeParse(value);
      if (!parsedSummary.success) {
        return err(
          parseFailed(
            `Unexpected summary row: ${z.prettifyError(parsedSummary.error)}`,
          ),
        );
      }
      summary = parsedSummary.data;
      continue;
    }

    const parsedRow = rowSchema.safeParse(value);
    if (!parsedRow.success) {
      return err(
        parseFailed(`Unexpected row: ${z.prettifyError(parsedRow.error)}`),
      );
    }
    rows.push(parsedRow.data);
  }

  return ok({ rows, summary });
};

/** `status`, `report` and the single-write commands emit exactly one JSON object. */
export const parseSingle = <T>(
  schema: z.ZodType<T>,
  stdout: string,
): Result<T, OledError> => {
  const line = nonEmptyLines(stdout).at(0);
  if (line === undefined)
    return err(parseFailed("Expected one JSON object, got no output"));

  const value = safeJsonParse(line);
  if (value === undefined) {
    return err(parseFailed(`Expected one JSON object, got: ${preview(line)}`));
  }

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return err(
      parseFailed(`Unexpected output: ${z.prettifyError(parsed.error)}`),
    );
  }
  return ok(parsed.data);
};
