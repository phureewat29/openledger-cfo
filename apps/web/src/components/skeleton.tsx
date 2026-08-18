import { cn } from "@openledger-cfo/ui";

/** The loading line's sweep, worn by quiet blocks instead of type. */
const SHEEN =
  "animate-[shimmer-sweep_2.4s_linear_infinite] rounded-[2px] bg-[linear-gradient(90deg,var(--color-secondary)_38%,var(--color-border)_50%,var(--color-secondary)_62%)] bg-[length:200%_100%]";

/**
 * A line of text that has not arrived. The no-break space is the whole trick:
 * the bar takes the exact line box of the type it stands in for, so a skeleton
 * built from the real row's classes holds the real row's height to the pixel.
 * Size it with the same text-size class the value will render at, plus a width.
 */
export function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(SHEEN, "max-w-full min-w-0 select-none", className)}
    >
      {"\u00A0"}
    </span>
  );
}

/** A block that has not arrived — charts, sparks, meters. Carries its own height. */
export function ShimmerBox({ className }: { className?: string }) {
  return <span aria-hidden className={cn(SHEEN, className)} />;
}
