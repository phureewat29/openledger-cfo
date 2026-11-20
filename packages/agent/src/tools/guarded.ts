import type { StructuredToolInterface } from "@langchain/core/tools";
import type { output, ZodObject } from "zod/v4";
import { tool } from "@langchain/core/tools";
import { attemptAsync } from "es-toolkit";

import { quoteShellArg } from "@openledger-cfo/openledger";

/** `content_and_artifact` wants [what the model reads, what the UI renders]. */
export const toolResult = <T>(value: T): [string, T] => [
  JSON.stringify(value),
  value,
];

export interface ToolFailure {
  status: "error";
  message: string;
}

interface ToolFields<S> {
  name: string;
  description: string;
  schema: S;
}

/** A thrown error would end the whole run; as data, the model can retry or move on. */
export const guardedTool = <S extends ZodObject>(
  run: (input: output<S>) => Promise<[string, unknown]>,
  fields: ToolFields<S>,
): StructuredToolInterface =>
  tool(
    async (input: output<S>) => {
      const [cause, result] = await attemptAsync(() => run(input));
      return (
        result ??
        toolResult<ToolFailure>({
          status: "error",
          message:
            cause instanceof Error ? cause.message : "the command failed",
        })
      );
    },
    { ...fields, responseFormat: "content_and_artifact" },
  );

/** Reads rebuild their command for display; writes carry the one the connector ran. */
export const oledCommand = (...args: (string | undefined)[]): string =>
  ["oled", ...args.filter((arg) => arg !== undefined).map(quoteShellArg)].join(
    " ",
  );
