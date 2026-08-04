import { appRouter, createTRPCContext } from "@openledger-fleet/api";
import { quoteShellArg } from "@openledger-fleet/openledger";

/**
 * One caller per process, over the api package's own connector: every tool call
 * queues on the same serial lanes as the app's commands rather than racing them
 * at the ledger file, and lands in the same live command log.
 */
export const caller: ReturnType<typeof appRouter.createCaller> =
  appRouter.createCaller(createTRPCContext({ headers: new Headers() }));

/** `content_and_artifact` wants [what the model reads, what the UI renders]. */
export const toolResult = <T>(value: T): [string, T] => [
  JSON.stringify(value),
  value,
];

export interface ToolFailure {
  status: "error";
  message: string;
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "the command failed";

/**
 * A thrown error would end the whole run; returned as data, the model can
 * retry the step or move to the next file, which its own rules require.
 */
export const guardedRun = async (
  run: () => Promise<[string, unknown]>,
): Promise<[string, unknown]> => {
  try {
    return await run();
  } catch (cause) {
    return toolResult({ status: "error", message: messageOf(cause) });
  }
};

/**
 * Writes travel with the command the connector ran; reads do not, so a read's
 * displayed command is rebuilt here from the flags it passed.
 */
export const oledCommand = (...args: (string | undefined)[]): string =>
  ["oled", ...args.filter((arg) => arg !== undefined).map(quoteShellArg)].join(
    " ",
  );
