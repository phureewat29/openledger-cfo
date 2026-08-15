import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ledger } from "@openledger-fleet/api";

const MAX_BYTES = 30 * 1024 * 1024;

/** What `oled ingest prepare` can read: a statement PDF or a photo of one. */
const EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);

/** Names collide when the same statement is dropped twice; past this it is a loop. */
const MAX_SUFFIX = 20;

const fail = (status: number, error: string) =>
  Response.json({ ok: false, error }, { status });

const extensionOf = (name: string): string | undefined => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? undefined : name.slice(dot + 1).toLowerCase();
};

/**
 * The upload names a file in the ledger's data dir, so the browser's string is
 * reduced to one path segment: basename only, normalized, and stripped of
 * everything a shell or a file walk could read as structure.
 */
const safeName = (raw: string): string | undefined => {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const name = base
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._ -]/g, "-")
    .trim();
  if (name.length === 0 || name.startsWith(".")) return undefined;
  return name;
};

const errnoOf = (cause: unknown): string | undefined =>
  cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined;

/**
 * `wx` is the claim: the first writer of a name wins and a second dropped copy
 * gets its own file rather than overwriting a statement waiting to be ingested.
 */
const writeUnique = async (
  dir: string,
  stem: string,
  extension: string,
  bytes: Buffer,
): Promise<string | undefined> => {
  for (let attempt = 0; attempt <= MAX_SUFFIX; attempt++) {
    const name =
      attempt === 0
        ? `${stem}.${extension}`
        : `${stem}-${attempt}.${extension}`;
    try {
      await writeFile(join(dir, name), bytes, { flag: "wx" });
      return name;
    } catch (failure) {
      if (errnoOf(failure) !== "EEXIST") {
        throw failure instanceof Error
          ? failure
          : new Error(`Could not write ${name}`);
      }
    }
  }
  return undefined;
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

    const extension = extensionOf(file.name);
    if (extension === undefined || !EXTENSIONS.has(extension)) {
      return fail(415, "Only PDF, PNG, JPG and WEBP files can be ingested.");
    }

    const name = safeName(file.name);
    if (name === undefined) {
      return fail(400, "That filename has nothing usable in it.");
    }

    const dir = await ledger.config.dataDir();
    if (!dir.ok) {
      return fail(503, dir.error.message);
    }

    // The validated extension is written back lowercase so the ledger's walk
    // sees one spelling of each name.
    const stem = name.slice(0, name.length - extension.length - 1);
    const relPath = await writeUnique(
      dir.value,
      stem,
      extension,
      Buffer.from(await file.arrayBuffer()),
    );
    if (relPath === undefined) {
      return fail(409, `${name} already exists, and so do its 20 copies`);
    }

    return Response.json({ ok: true, relPath });
  } catch (cause) {
    return fail(500, cause instanceof Error ? cause.message : "Upload failed");
  }
}
