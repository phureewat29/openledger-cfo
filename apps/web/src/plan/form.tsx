"use client";

import { useEffect, useRef } from "react";

import { Button } from "@openledger-cfo/ui/button";

// A quiet footer row until asked; Escape closes and the trigger takes focus back.
function AddDisclosure({
  label,
  open,
  onOpen,
  onClose,
  children,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // Closing unmounts whatever held focus; hand it back to the trigger.
  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!open) {
    return (
      <div className="border-border shrink-0 border-t px-1 py-1.5">
        <Button
          ref={trigger}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground w-full justify-start px-2"
          onClick={onOpen}
        >
          + {label}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      {children}
    </div>
  );
}

// Fully controlled: callers keep open/added so an action outside the form can clear them.
export function PlanForm({
  label,
  open,
  onOpen,
  onClose,
  onSubmit,
  onInput,
  submitLabel,
  pending,
  error,
  added,
  children,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onInput: () => void;
  submitLabel: string;
  pending: boolean;
  error?: { message: string } | null;
  added: string | undefined;
  children: React.ReactNode;
}) {
  const status = () => {
    if (error) {
      return <p className="text-destructive text-[10px]">{error.message}</p>;
    }
    if (added === undefined) return null;
    return <p className="text-accent text-[10px]">{added}</p>;
  };

  return (
    <AddDisclosure label={label} open={open} onOpen={onOpen} onClose={onClose}>
      <form
        onSubmit={onSubmit}
        onInput={onInput}
        aria-label={label}
        className="border-border shrink-0 border-t px-3 py-2"
      >
        <div className="flex max-w-md flex-col gap-2">
          {children}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </div>

          {status()}
        </div>
      </form>
    </AddDisclosure>
  );
}
