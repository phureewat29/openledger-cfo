import { clearCliLog } from "@openledger-fleet/api";

import { clearEntries } from "~/server/ingest-journal";
import { resetRunSlot } from "~/server/ingest-run";

/**
 * `pnpm reset` empties the stores on disk, but the command log, the run
 * journal and the run slot live inside this process — this is how the script
 * reaches them. Local-only, like every route here.
 */
export function POST() {
  resetRunSlot();
  clearEntries();
  clearCliLog();
  return Response.json({ ok: true });
}
