import { Button } from "@openledger-cfo/ui/button";

const REVEAL =
  "size-5 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100";

/**
 * The row-hover `×`. Rows whose own wrapper already drives the reveal (grouped
 * with a sibling action) pass `className` to take over from the default.
 */
export function RemoveButton({
  label,
  onClick,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className ?? REVEAL}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      ×
    </Button>
  );
}
