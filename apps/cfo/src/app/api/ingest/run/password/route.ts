import { z } from "zod/v4";

import { skipWaiting, submitPassword } from "~/server/ingest-run";

export const dynamic = "force-dynamic";

/**
 * Body only. The password is never a query parameter, never echoed back in an
 * error, and never written anywhere but the argv the connector masks.
 */
const BodySchema = z.union([
  z.object({ password: z.string().min(1).max(200) }),
  z.object({ skip: z.literal(true) }),
]);

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'Send {"password":"…"} or {"skip":true}' },
      { status: 400 },
    );
  }

  const applied =
    "skip" in parsed.data
      ? skipWaiting()
      : await submitPassword(parsed.data.password);
  if (!applied.ok) {
    return Response.json(
      { ok: false, error: applied.error.message },
      { status: 404 },
    );
  }
  return Response.json({ ok: true });
}
