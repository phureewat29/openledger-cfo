"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@openledger-fleet/ui/button";

import type { RunMode } from "~/domain/ingest-run";
import { countNoun } from "~/domain/format";
import { RUN_MODES } from "~/domain/ingest-run";

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
    body: "Genuinely ambiguous questions wait for you.",
  },
];

const MODE_KEY = "cfo.ingest.mode";

const rememberedMode = (): RunMode | null =>
  RUN_MODES.find((mode) => mode === localStorage.getItem(MODE_KEY)) ?? null;

const remember = (mode: RunMode): void => {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Storage refused the write (private mode); the choice just is not kept.
  }
};

/** Locked names said in full before the line folds into a count. */
const NAMED_LOCKED = 3;

/**
 * A count, never a promise: the queue tells the app a file is encrypted and
 * untouched, and only `oled` finds out whether the password behind it works.
 */
const lockedLine = (locked: number): string => {
  const them = locked === 1 ? "it" : "them";
  return `${countNoun(locked, "locked file")} in this selection will be skipped — unlock ${them} in the list first to include ${them}.`;
};

/**
 * Mounted per opening, so the remembered read happens on the client each time
 * the dialog shows. The remembered choice takes `autofocus`, which is what
 * `showModal` hands focus to — Enter starts the run the way it started last.
 */
function Choices({
  files,
  locked,
  onPick,
  onClose,
}: {
  files: number;
  locked: readonly string[];
  onPick: (mode: RunMode) => void;
  onClose: () => void;
}) {
  const [remembered] = useState(rememberedMode);

  const pick = (mode: RunMode) => {
    remember(mode);
    onPick(mode);
  };

  return (
    <>
      <p className="label">How should questions be handled?</p>
      <p className="text-muted-foreground pt-1 text-[11px]">
        The run will work {countNoun(files, "file")}.
      </p>
      {locked.length === 0 ? null : (
        <>
          <p className="text-accent pt-1 text-[11px]">
            {lockedLine(locked.length)}
          </p>
          {locked.slice(0, NAMED_LOCKED).map((relPath) => (
            <p
              key={relPath}
              className="text-muted-foreground truncate text-[10px]"
            >
              {relPath}
            </p>
          ))}
          {locked.length <= NAMED_LOCKED ? null : (
            <p className="text-muted-foreground text-[10px]">
              …and {String(locked.length - NAMED_LOCKED)} more.
            </p>
          )}
        </>
      )}
      <div className="flex flex-col gap-2 pt-3">
        {CHOICES.map((choice) => (
          <button
            key={choice.mode}
            type="button"
            autoFocus={choice.mode === remembered}
            onClick={() => pick(choice.mode)}
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
  );
}

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
  /** How many files the choice is about, so the question names its scope. */
  files: number;
  /** The files no run can read until a password arrives, by name. */
  locked: readonly string[];
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
        <Choices
          files={files}
          locked={locked}
          onPick={onPick}
          onClose={onClose}
        />
      ) : null}
    </dialog>
  );
}
