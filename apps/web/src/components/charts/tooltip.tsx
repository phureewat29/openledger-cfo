import { cn } from "@openledger-cfo/ui";

/** Clear of the cursor and of the mark the cursor is reading. */
const GAP = 10;
const EDGE = 8;

export interface TipRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  /** Background class for the 8×2 stroke sample; omitted where a single mark is read. */
  readonly tone?: string;
  /** A second figure the first one is a part of. */
  readonly note?: string;
}

/**
 * Placed against the plot's own box rather than the viewport, so a tooltip near
 * an edge turns back into the chart instead of off it. Anchoring by the far
 * side flips it without anyone having to measure how wide it turned out.
 */
export const tipPlacement = (
  x: number,
  y: number,
  width: number,
  height: number,
): React.CSSProperties => {
  const flipX = x > width / 2;
  const flipY = y < height / 2;
  return {
    left: flipX ? undefined : x + GAP,
    right: flipX ? width - x + GAP : undefined,
    top: flipY ? y + GAP : undefined,
    bottom: flipY ? undefined : height - y + GAP,
    maxWidth: Math.max(width - EDGE * 2, 96),
  };
};

/**
 * Appears at once and leaves at once: a fade is a delay between asking for a
 * figure and reading it. Every figure here is also in the readout or the row
 * beside it, which is what lets the tip itself stay out of the a11y tree.
 */
export function ChartTip({
  header,
  rows,
  className,
  style,
}: {
  header?: string;
  rows: readonly TipRow[];
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        "border-border bg-card pointer-events-none absolute z-10 rounded-md border px-2 py-1 text-[11px]",
        className,
      )}
    >
      {header === undefined ? null : (
        <div className="text-muted-foreground truncate text-[10px]">
          {header}
        </div>
      )}
      {rows.map((row) => (
        <div
          key={row.key}
          className="flex items-center gap-1.5 whitespace-nowrap"
        >
          {row.tone === undefined ? null : (
            <span className={cn("h-[2px] w-2 shrink-0", row.tone)} />
          )}
          <span className="text-muted-foreground min-w-0 truncate text-[10px]">
            {row.label}
          </span>
          <span className="ml-auto shrink-0 tabular-nums">{row.value}</span>
          {row.note === undefined ? null : (
            <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
              {row.note}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
