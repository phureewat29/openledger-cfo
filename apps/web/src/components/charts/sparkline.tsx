import { extent } from "d3-array";
import { scaleLinear } from "d3-scale";
import { line as toLine } from "d3-shape";

import type { Point } from "~/domain/series/types";
import { paddedDomain } from "~/domain/series/account";

const STROKE = 1.25;
/** Half of the 3px dot that says which end is now. */
const DOT = 1.5;

/**
 * A shape beside a figure the reader already has — no axis, no hover, no
 * readout. Drawn at its final size rather than stretched to a slot, so the
 * stroke and the dot stay round.
 */
export function Sparkline({
  points,
  width,
  height,
  label,
}: {
  points: readonly Point[];
  width: number;
  height: number;
  label: string;
}) {
  if (points.length < 2) return null;

  const [low, high] = extent(points, (point) => point.y);
  const bottom = low ?? 0;
  const top = high ?? 0;
  const { low: floor, high: ceiling } = paddedDomain(bottom, top);
  const inset = DOT + STROKE;
  const y = scaleLinear()
    .domain([floor, ceiling])
    .range([height - inset, inset]);
  const x = scaleLinear()
    .domain([0, points.length - 1])
    .range([inset, width - inset]);

  const path =
    toLine<Point>()
      .x((_, index) => x(index))
      .y((point) => y(point.y))(points) ?? "";
  const end = points.at(-1);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      role="img"
      aria-label={label}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--color-muted-foreground)"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {end === undefined ? null : (
        <circle
          cx={x(points.length - 1)}
          cy={y(end.y)}
          r={DOT}
          fill="var(--color-muted-foreground)"
        />
      )}
    </svg>
  );
}
