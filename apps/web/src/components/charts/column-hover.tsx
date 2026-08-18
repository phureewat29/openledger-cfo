"use client";

import { useState } from "react";

import { cn } from "@openledger-cfo/ui";

import type { TipRow } from "~/components/charts/tooltip";
import { bandDim, bandOpacity } from "~/components/charts/tone";
import { ChartTip } from "~/components/charts/tooltip";

export interface HoverColumn {
  readonly key: string;
  readonly header: string;
  readonly rows: readonly TipRow[];
}

export interface HoverBand {
  readonly key: string;
  readonly label: string;
  /** Background class for the swatch. */
  readonly tone: string;
  /** Its place in the window-wide ranking, which is what the lift addresses. */
  readonly rank: number;
}

const NO_BANDS: readonly HoverBand[] = [];

/**
 * The bars stay server markup; this only lays a row of hit cells over them,
 * mirroring their flex layout so a column never has to be found in pixels.
 * Nothing here is measured, so a resize cannot move the two out of step.
 */
export function ColumnHover({
  columns,
  bands = NO_BANDS,
  children,
}: {
  columns: readonly HoverColumn[];
  /** Omitted for a single series, which needs no key telling it apart from what. */
  bands?: readonly HoverBand[];
  children: React.ReactNode;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const [lit, setLit] = useState<number | null>(null);
  const column = hot === null ? undefined : columns[hot];
  // Placed on the far side of the column it reads, so it never covers it.
  const share = hot === null ? 0 : (hot + 0.5) / columns.length;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-2"
      style={bandDim(lit)}
      onPointerLeave={() => {
        setHot(null);
        setLit(null);
      }}
    >
      {bands.length === 0 ? null : (
        <ul className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
          {bands.map((band) => (
            <li
              key={band.key}
              onPointerEnter={() => {
                setLit(band.rank);
                setHot(null);
              }}
              onPointerLeave={() => setLit(null)}
              style={{ opacity: bandOpacity(band.rank) }}
              className="text-muted-foreground flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase transition-opacity duration-150"
            >
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-[1px]", band.tone)}
              />
              {band.label}
            </li>
          ))}
        </ul>
      )}

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex gap-1">
          {columns.map((entry, index) => (
            <div
              key={entry.key}
              onPointerEnter={() => {
                setHot(index);
                setLit(null);
              }}
              className={cn(
                "relative min-w-0 flex-1 cursor-crosshair transition-colors duration-150",
                index === hot && "bg-secondary/40",
              )}
            >
              {index === hot ? (
                <span
                  aria-hidden
                  className="bg-border absolute inset-y-0 left-1/2 w-px"
                />
              ) : null}
            </div>
          ))}
        </div>

        {/* The bars sit above the cells so the band reads behind them, and let
            every event through to the row that is doing the hit-testing. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col">
          {children}
        </div>

        {/* A column with nothing to report shows nothing: an empty readout
            would state a figure where the series has no reading. */}
        {column === undefined || column.rows.length === 0 ? null : (
          <ChartTip
            header={column.header}
            rows={column.rows}
            className="top-0"
            // Capped at the space between the anchor and the plot's far edge,
            // so a narrow pane truncates the tip instead of clipping it.
            style={
              share > 0.5
                ? {
                    right: `${(1 - share) * 100}%`,
                    marginRight: 6,
                    maxWidth: `calc(${share * 100}% - 6px)`,
                  }
                : {
                    left: `${share * 100}%`,
                    marginLeft: 6,
                    maxWidth: `calc(${(1 - share) * 100}% - 6px)`,
                  }
            }
          />
        )}
      </div>
    </div>
  );
}
