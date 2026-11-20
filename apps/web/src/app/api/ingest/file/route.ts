import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod/v4";

import type { OledErrorKind } from "@openledger-cfo/openledger";
import { ledger } from "@openledger-cfo/api";
import { fileIdSchema } from "@openledger-cfo/openledger";

import type { IngestFile } from "~/ingest/files";
import { fail } from "~/app/api/ingest/reply";
import { REMOVAL } from "~/ingest/files";

const bodySchema = z.object({
  relPath: z.string().min(1).max(500),
  status: z.enum(Object.keys(REMOVAL) as IngestFile["status"][]),
  fileId: fileIdSchema.optional(),
});

/** The two a stale queue can cause; every other kind is this server's problem. */
const DROP_STATUS: Partial<Record<OledErrorKind, number>> = {
  not_found: 404,
  invalid: 400,
};

export async function DELETE(request: Request) {
  try {
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      return fail(
        400,
        "The delete request was malformed — reload the page and try again.",
      );
    }

    const { relPath, status, fileId } = body.data;
    const recipe = REMOVAL[status];
    if (recipe === "refuse") {
      return fail(
        409,
        "An ingested file stays where it is — taking one back off the ledger is not something this page does.",
      );
    }

    const dir = await ledger.config.dataDir();
    if (!dir.ok) return fail(503, dir.error.message);

    // A rel_path can carry directories, so only the resolved path proves the target is inside the
    // directory the ledger walks. `relative` proves it for a drive root too, which ends in a separator.
    const root = resolve(dir.value);
    const path = resolve(root, relPath);
    const inside = relative(root, path);
    if (inside === "" || isAbsolute(inside) || inside.split(sep)[0] === "..") {
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
