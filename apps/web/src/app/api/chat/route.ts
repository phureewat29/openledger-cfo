import type { UIMessage } from "ai";
import { z } from "zod/v4";

import { createAgent, startIngestRunTool } from "@openledger-cfo/agent";
import { readGateway } from "@openledger-cfo/api";

import { accountViewBlock, buildBriefing } from "~/server/briefing";
import { loadDashboard } from "~/server/dashboard";
import { startRun } from "~/server/ingest-run";

export const maxDuration = 300;

const BodySchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
  context: z.object({ path: z.string().max(200) }).optional(),
});

const PATH_PATTERN = /^\/(?:accounts\/[A-Za-z0-9:%._-]+)?$/;

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
    const rawPath = body.context?.path ?? "/";
    const path = PATH_PATTERN.test(rawPath) ? rawPath : "/";

    const system = await systemFor(path);

    const agent = createAgent("cfo", {
      gateway,
      system,
      followUps: true,
      // The runner lives in this app's module graph; the agent package takes
      // the tool ready-made rather than importing upward.
      extraTools: [
        startIngestRunTool(async (paths, mode) => {
          const started = await startRun({ pathOrIds: [...paths] }, mode);
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

const ACCOUNT_PATH = /^\/accounts\/([^/]+)$/;

const systemFor = async (path: string) => {
  const loaded = await loadDashboard();
  const facts = loaded.ok ? buildBriefing(loaded.value) : undefined;
  const match = ACCOUNT_PATH.exec(path);
  if (!match?.[1]) return facts;

  const view = await accountViewBlock(decodeURIComponent(match[1]));
  if (!view) return facts;
  return facts ? `${facts}\n\n${view}` : view;
};
