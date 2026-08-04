import type { UIMessage } from "ai";
import { z } from "zod/v4";

import {
  createAgent,
  isAiEnabled,
  startIngestRunTool,
} from "@openledger-fleet/agent";

import { buildBriefing } from "~/ai/system";
import { accountViewBlock } from "~/ai/view-context";
import { env } from "~/env";
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
  if (!isAiEnabled()) {
    return Response.json(
      {
        error: "OPENROUTER_API_KEY not set",
        hint: "Add OPENROUTER_API_KEY to .env to enable Corgi. The rest of the terminal works without it.",
      },
      { status: 503 },
    );
  }

  try {
    const body = BodySchema.parse(await request.json());
    const rawPath = body.context?.path ?? "/";
    const path = PATH_PATTERN.test(rawPath) ? rawPath : "/";

    const system = await systemFor(path);
    if (env.NODE_ENV === "development") {
      console.log(">>> chat", { path });
    }

    const agent = createAgent("cfo", {
      system,
      // The runner lives in this app's module graph; the agent package takes
      // the tool ready-made rather than importing upward.
      extraTools: [
        startIngestRunTool(async (paths, mode) => {
          const started = await startRun({ pathOrIds: [...paths] }, mode);
          if (started.ok) return { ok: true, runId: started.runId };
          return { ok: false, message: started.message };
        }),
      ],
    });
    return agent.stream(body.messages, request.signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    console.error(">>> /api/chat failed", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

const ACCOUNT_PATH = /^\/accounts\/([^/]+)$/;

const systemFor = async (path: string) => {
  const loaded = await loadDashboard();
  const facts = loaded.ok ? buildBriefing(loaded.data) : undefined;
  const match = ACCOUNT_PATH.exec(path);
  if (!match?.[1]) return facts;

  const view = await accountViewBlock(decodeURIComponent(match[1]));
  if (!view) return facts;
  return facts ? `${facts}\n\n${view}` : view;
};
