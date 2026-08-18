"use client";

import { useEffect, useRef } from "react";

import { RECOMMENDED_MODELS } from "@openledger-cfo/agent/catalog";
import { Button } from "@openledger-cfo/ui/button";

/**
 * Mounted per opening, so the model the chat already uses takes `autofocus`,
 * which is what `showModal` hands focus to — Enter keeps things as they are.
 */
function Choices({
  current,
  onPick,
  onClose,
}: {
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <p className="label">Which model answers?</p>
      <p className="text-muted-foreground pt-1 text-[11px]">
        Benchmarked on ledger work; the choice holds for this conversation.
      </p>
      <div className="flex flex-col gap-2 pt-3">
        {RECOMMENDED_MODELS.map((choice) => (
          <button
            key={choice.id}
            type="button"
            autoFocus={choice.id === current}
            onClick={() => onPick(choice.id)}
            className="border-border hover:border-accent hover:bg-secondary/40 cursor-pointer rounded-md border px-3 py-2 text-left"
          >
            <span className="text-xs">{choice.label}</span>
            <span className="text-muted-foreground block text-[11px]">
              {choice.id}
            </span>
          </button>
        ))}
      </div>
      <div className="flex justify-end pt-3">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/**
 * The chat dock is itself fixed-positioned on small screens; a native modal
 * renders in the top layer above it, and brings the focus trap, the focus
 * restore and Escape with it — the same shell as the ingest mode dialog.
 */
export function ModelDialog({
  open,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  /** The id the chat is using now, so the dialog opens on it. */
  current: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

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
      aria-label="Which model answers?"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="bg-card text-foreground border-border m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border p-4 backdrop:bg-black/60"
    >
      {open ? (
        <Choices current={current} onPick={onPick} onClose={onClose} />
      ) : null}
    </dialog>
  );
}
