import { z } from "zod/v4";

import type { StartFailure } from "~/ingest/runner";
import { fail } from "~/app/api/ingest/reply";
import { listEntries } from "~/ingest/journal";
import { RUN_MODES } from "~/ingest/run";
import { cancelRun, readRun, startRun } from "~/ingest/runner";

// Memory the poller re-reads every couple of seconds; a cached answer is a lie.
export const dynamic = "force-dynamic";

const StartSchema = z.object({
  pathOrIds: z.array(z.string().min(1).max(500)).min(1).max(200),
  mode: z.enum(RUN_MODES),
});

const AfterSchema = z.coerce.number().int().min(0);

const START_STATUS: Record<StartFailure, number> = {
  disabled: 503,
  busy: 409,
  unavailable: 503,
};

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const start = StartSchema.safeParse(body);
  if (!start.success) {
    return fail(400, 'Send {"pathOrIds":["…"],"mode":"auto"|"normal"}');
  }

  const { pathOrIds, mode } = start.data;
  const started = await startRun(pathOrIds, mode);
  if (!started.ok) {
    return fail(START_STATUS[started.error.reason], started.error.message);
  }
  return Response.json({ ok: true, runId: started.value.runId });
}

/** Memory only: this answers without spawning a single `oled` process. */
export function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("after");
  const after = raw === null ? undefined : AfterSchema.safeParse(raw).data;
  return Response.json({ ok: true, ...listEntries(after), run: readRun() });
}

export function DELETE() {
  const cancelled = cancelRun();
  if (!cancelled.ok) return fail(404, cancelled.error.message);
  return Response.json({ ok: true });
}
