import { z } from "zod/v4";

import type { RunScope, StartFailure } from "~/server/ingest-run";
import { RUN_MODES } from "~/domain/ingest-run";
import { listEntries } from "~/server/ingest-journal";
import { cancelRun, readRun, startRun } from "~/server/ingest-run";

// Memory the poller re-reads every couple of seconds; a cached answer is a lie.
export const dynamic = "force-dynamic";

const name = z.string().min(1).max(500);

/** Today's behaviour is the default, so an older caller keeps working. */
const mode = z.enum(RUN_MODES).default("auto");

const StartSchema = z.union([
  z.object({ all: z.literal(true), mode }),
  z.object({ pathOrId: name, mode }),
  z.object({ pathOrIds: z.array(name).min(1).max(200), mode }),
]);

const scopeOf = (input: z.infer<typeof StartSchema>): RunScope => {
  if ("all" in input) return { all: true };
  if ("pathOrId" in input) return { pathOrId: input.pathOrId };
  return { pathOrIds: input.pathOrIds };
};

const AfterSchema = z.coerce.number().int().min(0);

const START_STATUS: Record<StartFailure, number> = {
  disabled: 503,
  busy: 409,
  unavailable: 503,
};

const fail = (status: number, error: string) =>
  Response.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const start = StartSchema.safeParse(body);
  if (!start.success) {
    return fail(
      400,
      'Send {"all":true}, {"pathOrId":"…"} or {"pathOrIds":["…"]}, with an optional {"mode":"auto"|"normal"}',
    );
  }

  const started = await startRun(scopeOf(start.data), start.data.mode);
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
