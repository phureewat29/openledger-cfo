import { Button } from "@openledger-cfo/ui/button";

import { AddDisclosure } from "~/plan/add-disclosure";

/**
 * The disclosure, field shell, and submit/cancel/status footer every plan
 * form repeats. Fully controlled — callers keep the open/added state so an
 * action outside the form (like completing a list row) can still clear it.
 */
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
