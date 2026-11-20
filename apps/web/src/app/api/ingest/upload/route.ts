import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attemptAsync, range } from "es-toolkit";

import type { Result } from "@openledger-cfo/openledger";
import { ledger } from "@openledger-cfo/api";
import { err, ok } from "@openledger-cfo/openledger";

import { fail } from "~/app/api/ingest/reply";
import {
  safeUploadName,
  UPLOAD_TYPE_ERROR,
  uploadExtensionOf,
} from "~/ingest/files";

const MAX_BYTES = 30 * 1024 * 1024;

/** Names collide when the same statement is dropped twice; past this it is a loop. */
const MAX_SUFFIX = 20;

const errnoOf = (cause: unknown): string | undefined =>
  cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined;

type WriteFailure = "exhausted" | "io";

const WRITE_STATUS: Record<WriteFailure, number> = { exhausted: 409, io: 500 };

/**
 * `wx` is the claim: a second copy of a name gets its own file instead of overwriting
 * one waiting to be ingested. The extension is written lowercase, one spelling per name.
 */
const writeUnique = async (
  dir: string,
  name: string,
  extension: string,
  bytes: Buffer,
): Promise<Result<string, { reason: WriteFailure; message: string }>> => {
  const stem = name.slice(0, name.length - extension.length - 1);
  for (const suffix of range(MAX_SUFFIX + 1)) {
    const candidate =
      suffix === 0 ? `${stem}.${extension}` : `${stem}-${suffix}.${extension}`;
    const [failure] = await attemptAsync<void, unknown>(() =>
      writeFile(join(dir, candidate), bytes, { flag: "wx" }),
    );
    if (failure === null) return ok(candidate);
    if (errnoOf(failure) !== "EEXIST") {
      return err({
        reason: "io",
        message:
          failure instanceof Error
            ? failure.message
            : `Could not write ${candidate}`,
      });
    }
  }
  return err({
    reason: "exhausted",
    message: `${name} already exists, and so do its ${String(MAX_SUFFIX)} copies`,
  });
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return fail(400, "No file was attached to this upload.");
    }
    if (file.size === 0) {
      return fail(400, "That file is empty.");
    }
    if (file.size > MAX_BYTES) {
      return fail(413, "That file is larger than the 30 MB limit.");
    }

    const extension = uploadExtensionOf(file.name);
    if (extension === undefined) {
      return fail(415, UPLOAD_TYPE_ERROR);
    }

    const name = safeUploadName(file.name);
    if (name === undefined) {
      return fail(400, "That filename has nothing usable in it.");
    }

    const dir = await ledger.config.dataDir();
    if (!dir.ok) {
      return fail(503, dir.error.message);
    }

    const written = await writeUnique(
      dir.value,
      name,
      extension,
      Buffer.from(await file.arrayBuffer()),
    );
    if (!written.ok) {
      return fail(WRITE_STATUS[written.error.reason], written.error.message);
    }

    return Response.json({ ok: true, relPath: written.value });
  } catch (cause) {
    return fail(500, cause instanceof Error ? cause.message : "Upload failed");
  }
}
