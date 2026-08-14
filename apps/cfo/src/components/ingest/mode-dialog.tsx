"use client";

import { useEffect, useRef } from "react";

import { Button } from "@openledger-fleet/ui/button";

import type { RunMode } from "~/domain/ingest-run";
import { countNoun } from "~/domain/format";

const CHOICES: readonly {
  readonly mode: RunMode;
  readonly title: string;
  readonly body: string;
}[] = [
  {
    mode: "auto",
    title: "Auto",
    body: "The agent resolves every question itself.",
  },
  {
    mode: "normal",
    title: "Normal",
    body: "Genuinely ambiguous items wait for you.",
  },
];

/**
 * A count, never a promise: the queue tells the app a file is encrypted and
 * untouched, and only `oled` finds out whether the password behind it works.
 */
const lockedLine = (locked: number, all: boolean): string => {
  const them = locked === 1 ? "it" : "them";
  return `${countNoun(locked, "locked file")}${all ? "" : " in this pick"} will be skipped — unlock ${them} in the list first to include ${them}.`;
};

/**
 * Every pane on this page sits inside an `@container`, which makes its
 * ancestor the containing block for anything fixed — a hand-rolled overlay
 * lands inside the column it came from. A native modal renders in the top
 * layer, and brings the focus trap, the focus restore and Escape with it.
 */
export function ModeDialog({
  open,
  files,
  locked,
  onPick,
  onClose,
}: {
  open: boolean;
  /** How many statements the choice is about, so the question names its scope. */
  files: number | null;
  /** How many of this scope's files no run can read until a password arrives. */
  locked: number;
  onPick: (mode: RunMode) => void;
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

  const scope =
    files === null ? "the whole queue" : countNoun(files, "statement");

  return (
    <dialog
      ref={dialog}
      aria-label="How should questions be handled?"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="bg-card text-foreground border-border m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border p-4 backdrop:bg-black/60"
    >
      {open ? (
        <>
          <p className="label">How should questions be handled?</p>
          <p className="text-muted-foreground pt-1 text-[11px]">
            The run will work {scope}.
          </p>
          {locked === 0 ? null : (
            <p className="text-accent pt-1 text-[11px]">
              {lockedLine(locked, files === null)}
            </p>
          )}
          <div className="flex flex-col gap-2 pt-3">
            {CHOICES.map((choice) => (
              <button
                key={choice.mode}
                type="button"
                onClick={() => onPick(choice.mode)}
                className="border-border hover:border-accent hover:bg-secondary/40 cursor-pointer rounded-md border px-3 py-2 text-left"
              >
                <span className="text-xs">{choice.title}</span>
                <span className="text-muted-foreground block text-[11px]">
                  {choice.body}
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
      ) : null}
    </dialog>
  );
}
