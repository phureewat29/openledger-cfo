import { Button } from "@openledger-cfo/ui/button";

const REVEAL =
  "size-5 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100";

// The row-hover `×`; a `className` replaces the default reveal for rows that drive their own.
export function RemoveButton({
  label,
  onClick,
  disabled,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
