import { cn } from "@openledger-cfo/ui";

// A no-break space holds the line box of the type it stands in for; give it the value's text size.
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

// A soft band of accent passing over an otherwise invisible block.
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
