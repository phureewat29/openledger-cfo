import type { UIMessage } from "ai";
import { z } from "zod/v4";

import { createAgent, startIngestRunTool } from "@openledger-cfo/agent";
import { readGateway } from "@openledger-cfo/api";

import { systemFor } from "~/chat/briefing";
import { startRun } from "~/ingest/runner";

export const maxDuration = 300;

const BodySchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
  context: z.object({ path: z.string().max(200) }).optional(),
});

/** The one boundary that catches: every failure below becomes a JSON body. */
export async function POST(request: Request) {
  const gateway = await readGateway();
  if (gateway === undefined) {
    return Response.json(
      {
        error: "AI gateway not configured",
        hint: "Open the AI settings in the app and save a base URL, API key, and model. The rest of the terminal works without it.",
      },
      { status: 503 },
    );
  }

  try {
    const body = BodySchema.parse(await request.json());
    const system = await systemFor(body.context?.path);

    const agent = createAgent("cfo", {
      gateway,
      system,
      followUps: true,
      // The runner lives in this app's module graph; the agent package takes
      // the tool ready-made rather than importing upward.
      extraTools: [
        startIngestRunTool(async (paths, mode) => {
          const started = await startRun(paths, mode);
          if (started.ok) return { ok: true, runId: started.value.runId };
          return { ok: false, message: started.error.message };
        }),
      ],
    });
    return agent.stream(body.messages, request.signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    console.error("/api/chat failed", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
