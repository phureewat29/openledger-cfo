import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod/v4";

import type { OledErrorKind } from "@openledger-fleet/openledger";
import { FILE_ID_PATTERN, ledger } from "@openledger-fleet/api";

import type { IngestFile } from "~/server/ingest";

/**
 * How a row leaves the queue, by the status it was listed with. A file the
 * ledger never registered is only a file on disk; a registered one has to be
 * dropped first, or its rows and questions would outlive the statement they
 * came from. A closed file keeps both — un-ingesting is a ledger correction,
 * not a queue action.
 */
const RECIPE: Record<IngestFile["status"], "unlink" | "drop" | "refuse"> = {
  new: "unlink",
  unreadable: "unlink",
  pending: "drop",
  failed: "drop",
  ingested: "refuse",
};

const bodySchema = z.object({
  relPath: z.string().min(1).max(500),
  status: z.enum(["new", "pending", "ingested", "failed", "unreadable"]),
  fileId: z.string().regex(FILE_ID_PATTERN).optional(),
});

/** The two a stale queue can cause; every other kind is this server's problem. */
const DROP_STATUS: Partial<Record<OledErrorKind, number>> = {
  not_found: 404,
  invalid: 400,
};

const fail = (status: number, error: string) =>
  Response.json({ ok: false, error }, { status });

export async function DELETE(request: Request) {
  try {
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return fail(
        400,
        'Send {"relPath":"…","status":"…"} and, once the ledger holds one, {"fileId":"sf-…"}',
      );
    }

    const { relPath, status, fileId } = body.data;
    const recipe = RECIPE[status];
    if (recipe === "refuse") {
      return fail(
        409,
        "An ingested file stays where it is — taking one back off the ledger is not something this page does.",
      );
    }

    const dir = await ledger.config.dataDir();
    if (!dir.ok) return fail(503, dir.error.message);

    // A rel_path names a walk result and can carry directories, so reducing it
    // to a basename would unlink the wrong file. Only the resolved path proves
    // the target is inside the directory the ledger walks.
    const root = resolve(dir.value);
    const path = resolve(root, relPath);
    if (!path.startsWith(root + sep)) {
      return fail(400, "That path is outside the data directory");
    }

    if (recipe === "drop") {
      if (fileId === undefined) {
        return fail(
          400,
          "The ledger holds this file; its id has to come with it",
        );
      }
      const dropped = await ledger.files.drop(fileId);
      if (!dropped.ok) {
        return fail(
          DROP_STATUS[dropped.error.kind] ?? 500,
          dropped.error.message,
        );
      }
    }

    // Deregistering first is what makes this safe to repeat: the ledger no
    // longer knows the id, so a second attempt is a plain unlink.
    await rm(path, { force: true });
    return Response.json({ ok: true });
  } catch (cause) {
    return fail(500, cause instanceof Error ? cause.message : "Delete failed");
  }
}
