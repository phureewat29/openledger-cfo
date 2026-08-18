"use client";

import { useEffect, useRef } from "react";

import { Button } from "@openledger-cfo/ui/button";

/**
 * The pane's footer is a quiet row until asked: the form only spends its
 * height while somebody is actually adding, and the lists keep it otherwise.
 * Escape closes, and the trigger takes focus back when the form goes away.
 */
export function AddDisclosure({
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
