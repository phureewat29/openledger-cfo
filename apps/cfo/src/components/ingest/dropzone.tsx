"use client";

import { useId, useState } from "react";

import { cn } from "@openledger-fleet/ui";

interface UploadReply {
  ok: boolean;
  error?: string;
  relPath?: string;
}

interface UploadFailure {
  readonly name: string;
  readonly error: string;
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Upload failed";

const upload = async (file: File): Promise<UploadReply> => {
  const body = new FormData();
  body.append("file", file);
  return fetch("/api/ingest/upload", { method: "POST", body })
    .then((response) => response.json() as Promise<UploadReply>)
    .catch(
      (cause: unknown) =>
        ({ ok: false, error: messageOf(cause) }) satisfies UploadReply,
    );
};

export function Dropzone({ onUploaded }: { onUploaded: () => void }) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [failures, setFailures] = useState<readonly UploadFailure[]>([]);

  const busy = progress !== undefined;

  const send = async (picked: FileList | null) => {
    const files = Array.from(picked ?? []);
    if (files.length === 0) return;
    setProgress({ done: 0, total: files.length });
    setFailures([]);

    // One request per file: each failure keeps the route's own message, and
    // serial order keeps collision suffixes matching the order files were picked.
    const failed: UploadFailure[] = [];
    let landed = 0;
    for (const [index, file] of files.entries()) {
      setProgress({ done: index, total: files.length });
      const reply = await upload(file);
      if (reply.ok) landed += 1;
      else
        failed.push({ name: file.name, error: reply.error ?? "Upload failed" });
    }

    setProgress(undefined);
    setFailures(failed);
    if (landed > 0) onUploaded();
  };

  const label = () => {
    if (progress === undefined) {
      return "Drop statements, or click — PDF, PNG, JPG, WEBP";
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
      {failures.map((failure) => (
        <p key={failure.name} className="text-destructive text-xs">
          {failure.name} — {failure.error}
        </p>
      ))}
    </div>
  );
}
