import { tool } from "@langchain/core/tools";
import { z } from "zod/v4";

import { guardedRun, toolResult } from "./caller";

export type RunnerMode = "auto" | "normal";

export type StartRunOutcome =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly message: string };

/** What the app's runner does when asked; the tool never sees the runner itself. */
export type StartIngestRun = (
  paths: readonly string[],
  mode: RunnerMode,
) => Promise<StartRunOutcome>;

/**
 * Built here, executed by the app: the runner lives in the app's module graph,
 * so the app passes this tool in through `extraTools` rather than this package
 * importing upward.
 */
export const startIngestRunTool = (start: StartIngestRun) =>
  tool(
    async ({ paths, mode }) =>
      guardedRun(async () => {
        const outcome = await start(paths, mode ?? "auto");
        if (!outcome.ok) {
          return toolResult({ status: "error", message: outcome.message });
        }
        return toolResult({
          started: true,
          runId: outcome.runId,
          note: "The run works in the background; the Ingest page feed shows each step.",
        });
      }),
    {
      name: "startIngestRun",
      description:
        "Start a background ingest run on the named statement files. The ingest agent prepares, posts and closes them; progress shows on the Ingest page. Refused while another run is live.",
      schema: z.object({
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe("Relative file paths as listFiles reports them"),
        mode: z
          .enum(["auto", "normal"])
          .optional()
          .describe(
            "auto finishes alone; normal parks open questions for the user",
          ),
      }),
      responseFormat: "content_and_artifact",
    },
  );
