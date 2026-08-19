"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@openledger-cfo/ui/button";

import { LoadingLine } from "~/components/loading-line";
import { useTRPC } from "~/trpc/react";
import { ConfigForm } from "./config-form";

function Notice({
  headline,
  detail,
  command,
  onClose,
}: {
  headline: string;
  detail?: string;
  command?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-medium">AI Gateway Configuration</h2>
      <p className="text-muted-foreground text-sm">{headline}</p>
      {command === undefined ? null : (
        <pre className="bg-secondary overflow-x-auto rounded-md p-3 text-sm">
          {command}
        </pre>
      )}
      {detail === undefined ? null : (
        <p className="text-muted-foreground text-[11px] break-words">
          {detail}
        </p>
      )}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

const STORE_NOTICE: Record<
  "missing-table" | "unavailable",
  { headline: string; command?: string }
> = {
  "missing-table": {
    headline:
      "The control plane is missing its configuration table. Create it, then come back here.",
    command: "pnpm db:push",
  },
  unavailable: {
    headline: "The control plane did not answer. Reload and try again.",
  },
};

/** Mounted per opening so the form reseeds from a fresh read every time. */
function Body({
  onClose,
  onSaving,
}: {
  onClose: () => void;
  onSaving: (saving: boolean) => void;
}) {
  const trpc = useTRPC();
  // Every open is a real read: a plain-overwrite form must never seed stale.
  const settings = useQuery(
    trpc.configuration.get.queryOptions(undefined, { staleTime: 0, gcTime: 0 }),
  );

  if (settings.isPending) {
    return (
      <div className="p-4">
        <LoadingLine />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <Notice
        headline="The settings could not be read."
        detail={settings.error.message}
        onClose={onClose}
      />
    );
  }
  if (settings.data.store !== "ready") {
    return <Notice {...STORE_NOTICE[settings.data.store]} onClose={onClose} />;
  }
  return (
    <ConfigForm initial={settings.data} onClose={onClose} onSaving={onSaving} />
  );
}

/**
 * Every pane sits inside an `@container`, which makes its ancestor the
 * containing block for anything fixed — a hand-rolled overlay lands inside the
 * column it came from. A native modal renders in the top layer, and brings the
 * focus trap, the focus restore and Escape with it. Wider than the pick
 * dialogs: gateway URLs and `vendor/model` ids should read whole.
 */
export function ConfigDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // A save in flight, only: tests write nothing and must stay escapable.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open) element.showModal();
    // Also the route-change exit: closing is what hands focus back.
    return () => element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label="AI Gateway Configuration"
      // The close event is the one funnel every exit passes through — it is
      // where a stale saving lock dies, so the next open cannot inherit it.
      onClose={() => {
        setSaving(false);
        onClose();
      }}
      // Escape must not orphan an in-flight save; its invalidations close the loop.
      onCancel={(event) => {
        if (saving) event.preventDefault();
      }}
      onClick={(event) => {
        if (!saving && event.target === dialog.current) onClose();
      }}
      className="bg-card text-foreground border-border m-auto max-h-[calc(100vh-2rem)] w-[min(44rem,calc(100vw-2rem))] overflow-hidden rounded-lg border p-0 backdrop:bg-black/60"
    >
      {open ? <Body onClose={onClose} onSaving={setSaving} /> : null}
    </dialog>
  );
}
