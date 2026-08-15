"use client";

import { useId, useState } from "react";
import { partition } from "es-toolkit";

import { cn } from "@openledger-fleet/ui";

import { RemoveButton } from "~/components/plan/remove-button";

type UploadReply =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

interface UploadFailure {
  readonly name: string;
  readonly error: string;
}

/** What one batch left behind, kept until the operator waves it away. */
interface Outcome {
  readonly landed: number;
  readonly total: number;
  readonly failures: readonly UploadFailure[];
}

/** Mirrors the upload route's gate, so a wrong type fails before the wire. */
const ALLOWED = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);
const TYPE_ERROR = "Only PDF, PNG, JPG and WEBP files can be ingested.";

const extensionOf = (name: string): string =>
  name.split(".").pop()?.toLowerCase() ?? "";

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Upload failed";

const upload = async (file: File): Promise<UploadReply> => {
  const body = new FormData();
  body.append("file", file);
  try {
    const response = await fetch("/api/ingest/upload", {
      method: "POST",
      body,
    });
    return (await response.json()) as UploadReply;
  } catch (cause) {
    return { ok: false, error: messageOf(cause) };
  }
};

export function Dropzone({ onUploaded }: { onUploaded: () => void }) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const busy = progress !== undefined;

  const send = async (picked: FileList | null) => {
    const files = Array.from(picked ?? []);
    if (files.length === 0) return;
    // The `accept` attribute only guards the picker; a drop bypasses it.
    const [supported, rejected] = partition(files, (file) =>
      ALLOWED.has(extensionOf(file.name)),
    );
    const failed: UploadFailure[] = rejected.map((file) => ({
      name: file.name,
      error: TYPE_ERROR,
    }));
    setOutcome(null);
    if (supported.length === 0) {
      setOutcome({ landed: 0, total: files.length, failures: failed });
      return;
    }
    setProgress({ done: 0, total: supported.length });

    // One request per file: each failure keeps the route's own message, and
    // serial order keeps collision suffixes matching the order files were picked.
    let landed = 0;
    for (const [index, file] of supported.entries()) {
      setProgress({ done: index, total: supported.length });
      const reply = await upload(file);
      if (reply.ok) landed += 1;
      else failed.push({ name: file.name, error: reply.error });
    }

    setProgress(undefined);
    setOutcome({ landed, total: files.length, failures: failed });
    if (landed > 0) onUploaded();
  };

  const label = () => {
    if (progress === undefined) {
      return "Drop files, or click — PDF, PNG, JPG, WEBP";
    }
    if (progress.total === 1) return "Uploading…";
    return `Uploading ${progress.done + 1}/${progress.total}…`;
  };

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void send(event.dataTransfer.files);
        }}
        className={cn(
          "border-border text-muted-foreground hover:border-accent/60 flex h-7 cursor-pointer items-center rounded-md border border-dashed px-2 text-xs",
          dragging && "border-accent text-foreground",
          busy && "cursor-progress",
        )}
      >
        {label()}
      </label>
      <input
        id={inputId}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        multiple
        disabled={busy}
        className="sr-only"
        onChange={(event) => {
          const input = event.currentTarget;
          const files = input.files;
          // Clearing the value lets the same selection be re-picked after a failure.
          void send(files);
          input.value = "";
        }}
      />
      {outcome === null ? null : (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {/* Every batch says what landed; a clean upload's only other
                feedback is rows appearing a poll later. */}
            {outcome.landed === 0 ? null : (
              <p className="text-muted-foreground text-xs">
                Uploaded {String(outcome.landed)} of {String(outcome.total)}.
              </p>
            )}
            {outcome.failures.map((failure, index) => (
              <p
                key={`${failure.name}-${String(index)}`}
                className="text-destructive text-xs"
              >
                {failure.name} — {failure.error}
              </p>
            ))}
          </div>
          <RemoveButton
            label="Dismiss upload failures"
            className="size-5 shrink-0"
            disabled={false}
            onClick={() => setOutcome(null)}
          />
        </div>
      )}
    </div>
  );
}
