import type { z } from "zod/v4";
import { isPlainObject } from "es-toolkit";

import type { OledError } from "./errors";
import type { Result } from "./result";
import { parseAs } from "./errors";
import { err, ok, parseJson } from "./result";

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

export interface ListPage<TRow, TSummary> {
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
): Result<ListPage<TRow, TSummary>, OledError> => {
  const rows: TRow[] = [];
  let summary: TSummary | undefined;

  for (const line of nonEmptyLines(stdout)) {
    const value = parseJson(line);
    if (value === undefined) {
      return err(parseFailed(`Expected NDJSON, got: ${preview(line)}`));
    }

    if (isSummary(value)) {
      if (!summarySchema) continue;
      const parsed = parseAs(
        summarySchema,
        value,
        "parse_failed",
        "Unexpected summary row",
      );
      if (!parsed.ok) return parsed;
      summary = parsed.value;
      continue;
    }

    const parsed = parseAs(rowSchema, value, "parse_failed", "Unexpected row");
    if (!parsed.ok) return parsed;
    rows.push(parsed.value);
  }

  return ok({ rows, summary });
};

/** First JSON object wins; trailing lines (a defer's summary row) are ignored. */
export const parseSingle = <T>(
  schema: z.ZodType<T>,
  stdout: string,
): Result<T, OledError> => {
  const line = nonEmptyLines(stdout).at(0);
  if (line === undefined)
    return err(parseFailed("Expected one JSON object, got no output"));

  const value = parseJson(line);
  if (value === undefined) {
    return err(parseFailed(`Expected one JSON object, got: ${preview(line)}`));
  }

  return parseAs(schema, value, "parse_failed", "Unexpected output");
};
