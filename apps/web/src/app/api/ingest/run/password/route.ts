import { z } from "zod/v4";

import { fail } from "~/app/api/ingest/reply";
import { skipWaiting, submitPassword } from "~/ingest/runner";

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
    return fail(
      400,
      "The password request was malformed — type the password again and resubmit.",
    );
  }

  const applied =
    "skip" in parsed.data
      ? await skipWaiting()
      : await submitPassword(parsed.data.password);
  if (!applied.ok) return fail(404, applied.error.message);
  return Response.json({ ok: true });
}
