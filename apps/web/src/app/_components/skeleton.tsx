import { cn } from "@openledger-cfo/ui";

/**
 * A line of text that has not arrived, holding its exact line box and nothing
 * more. The no-break space is the whole trick: the span takes the line box of
 * the type it stands in for, so a skeleton built from the real row's classes
 * holds the real row's height to the pixel. Size it with the same text-size
 * class the value will render at.
 */
export function GhostLine({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("max-w-full min-w-0 select-none", className)}
    >
      {"\u00A0"}
    </span>
  );
}

/**
 * The one loading effect left: a soft band of accent passing over an
 * otherwise invisible block. Only the accounts composition strip wears it;
 * every pane says its loading line instead.
 */
export function ShimmerBox({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "animate-[shimmer-sweep_2.4s_linear_infinite] rounded-[2px] bg-[linear-gradient(90deg,transparent_38%,color-mix(in_oklab,var(--color-accent)_30%,transparent)_50%,transparent_62%)] bg-[length:200%_100%]",
        className,
      )}
    />
  );
}
