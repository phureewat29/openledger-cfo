"use client";

import { useMemo, useRef, useState } from "react";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { compact, groupBy, identity, sortBy, sum } from "es-toolkit";

import type { FlowGraph, NodeKind } from "~/flows/flow";
import type { ChartSize } from "~/lib/charts/frame";
import type { TipRow } from "~/lib/charts/tooltip";
import { quantize, useChartSize } from "~/lib/charts/frame";
import { ChartTip, tipPlacement } from "~/lib/charts/tooltip";
import { formatPercent, formatThb, formatThbCompact } from "~/lib/format";

const WIDTH = 960;
const HEIGHT = 500;
// The side margins are the label columns, one width in both views; narrower clips names.
const MARGIN = { top: 26, right: 220, bottom: 14, left: 220 };
const NODE_WIDTH = 14;
const NODE_PADDING = 12;
const LABEL_GAP = 8;

/** A ribbon thinner than this is still a ribbon the pointer has to be able to find. */
const HIT_WIDTH = 12;
const HIT_HEIGHT = 16;

// Labels counter the render scale, then curve back so a bigger diagram reads a touch bigger.
const TYPE_CURVE = 0.25;
const BASE_NAME = 12;
const BASE_VALUE = 10;
const BASE_MARKER = 10;
/** A typical pane renders near this; the first measurement corrects it. */
const ASSUMED_SCALE = 0.7;

interface TypeSizes {
  readonly name: number;
  readonly value: number;
  readonly marker: number;
}

const typeFor = (scale: number): TypeSizes => {
  const svg = (base: number) => (base * scale ** TYPE_CURVE) / scale;
  return {
    name: svg(BASE_NAME),
    value: svg(BASE_VALUE),
    marker: svg(BASE_MARKER),
  };
};

const CHAR = 0.6;
const NAME_MAX = 16;
const EXPANDED_NAME_MAX = 26;

// Theme tokens rather than literals: `var()` resolves in inline SVG, so the
// diagram tracks the design system instead of pinning its own hexes.
const ACCENT = "var(--color-accent)";
const FOREGROUND = "var(--color-foreground)";
const MUTED = "var(--color-muted-foreground)";

// Colour marks a node's role, never its rank: a rank highlight would repaint mid-drag.
const NODE_FILL: Record<NodeKind, string> = {
  income: FOREGROUND,
  hub: FOREGROUND,
  category: MUTED,
  outcome: ACCENT,
};

// Neutral ribbons stay recessive so the accent "kept" flow reads first.
const LINK_TONE: Record<
  NodeKind,
  { stroke: string; rest: number; lit: number }
> = {
  income: { stroke: FOREGROUND, rest: 0.22, lit: 0.5 },
  hub: { stroke: FOREGROUND, rest: 0.22, lit: 0.5 },
  category: { stroke: FOREGROUND, rest: 0.22, lit: 0.5 },
  outcome: { stroke: ACCENT, rest: 0.75, lit: 1 },
};

const DIM = 0.08;

const LABEL_TONE: Record<NodeKind, string> = {
  income: "fill-foreground",
  hub: "fill-foreground font-medium",
  category: "fill-foreground",
  outcome: "fill-foreground font-medium",
};

/** Mutable on purpose: d3-sankey writes coordinates onto the data it is given. */
interface NodeDatum {
  id: string;
  label: string;
  kind: NodeKind;
  total: number;
}

interface LinkDatum {
  value: number;
}

interface PlacedNode {
  readonly id: string;
  readonly label: string;
  readonly kind: NodeKind;
  readonly total: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

type Mark = "label" | "marker" | "none";

interface LabelledNode extends PlacedNode {
  readonly name: string;
  readonly value: string;
  readonly mark: Mark;
  /** The number the diagram draws beside it; zero unless it draws one. */
  readonly note: number;
}

interface Note {
  readonly id: string;
  /** The number drawn beside the node, or empty where it drew none. */
  readonly glyph: string;
  readonly label: string;
  readonly value: string;
}

// No prefix for an unnumbered entry: a `·` would read as the app's clause separator.
const UNMARKED = "";

interface PlacedLink {
  readonly id: string;
  /** The node ids at either end, so hovering a node can lift exactly these. */
  readonly source: string;
  readonly target: string;
  readonly d: string;
  readonly width: number;
  readonly targetKind: NodeKind;
  readonly header: string;
  readonly value: number;
}

const linkKey = (source: string, target: string) => `${source}->${target}`;

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

// A combining mark (Thai vowels and tones above or below) stacks on its letter and adds no advance.
const widthOf = (text: string, size: number) =>
  text.replace(/\p{M}/gu, "").length * size * CHAR;

const centerOf = (node: PlacedNode) => (node.y0 + node.y1) / 2;

/** How much of a name the label column has room for once its figure is set. */
const truncate = (
  label: string,
  value: string,
  nameMax: number,
  type: TypeSizes,
) => {
  // Both gutters are set together; the narrower one is what every name must fit.
  const gutter =
    Math.min(MARGIN.left, MARGIN.right) -
    LABEL_GAP -
    widthOf(value, type.value) -
    type.name * CHAR;
  const room = Math.min(nameMax, Math.floor(gutter / (type.name * CHAR)));
  if (label.length <= room) return label;
  return `${label.slice(0, Math.max(room - 1, 1))}…`;
};

const markFor = (gap: number, type: TypeSizes): Mark => {
  if (gap >= type.name * 1.35) return "label";
  if (gap >= type.marker + 2) return "marker";
  return "none";
};

interface Marked {
  readonly node: PlacedNode;
  readonly mark: Mark;
}

/** Down one column, each node keeps only what its neighbour above left room for. */
const markColumn = (
  column: readonly PlacedNode[],
  type: TypeSizes,
): readonly Marked[] =>
  sortBy(column, [centerOf]).reduce<{
    cursor: number;
    marked: readonly Marked[];
  }>(
    ({ cursor, marked }, node) => {
      const mark = markFor(centerOf(node) - cursor, type);
      return {
        cursor: mark === "none" ? cursor : centerOf(node),
        marked: [...marked, { node, mark }],
      };
    },
    { cursor: -Infinity, marked: [] },
  ).marked;

/**
 * Greedy down each column: room keeps the name, less gets a number, none only a
 * listing. Everything that lost its name is listed, so nothing needs a hover.
 */
const placeLabels = (
  nodes: readonly PlacedNode[],
  nameMax: number,
  type: TypeSizes,
) => {
  const columns = sortBy(
    Object.entries(groupBy(nodes, (node) => String(Math.round(node.x0)))),
    [([x]) => Number(x)],
  );
  const marked = columns.flatMap(([, column]) => markColumn(column, type));
  // Counted apart from the strip's length: only a node the diagram draws a
  // number beside may claim one, so every printed number has something to find.
  const numbered = marked
    .filter(({ mark }) => mark === "marker")
    .map(({ node }) => node.id);

  const labelled = marked.map(({ node, mark }): LabelledNode => {
    const value = formatThbCompact(node.total);
    return {
      ...node,
      name: truncate(node.label, value, nameMax, type),
      value,
      mark,
      note: mark === "marker" ? numbered.indexOf(node.id) + 1 : 0,
    };
  });

  const notes = labelled
    .filter((node) => node.mark !== "label")
    .map((node): Note => ({
      id: node.id,
      glyph: node.note > 0 ? String(node.note) : UNMARKED,
      label: node.label,
      value: formatThb(node.total),
    }));

  return { labelled, notes };
};

const buildLayout = (graph: FlowGraph) => {
  const laid = sankey<NodeDatum, LinkDatum>()
    .nodeId((node) => node.id)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    // Column order is chosen upstream (biggest first, "Saved" on top), not derived.
    .nodeSort(null)
    .extent([
      [MARGIN.left, MARGIN.top],
      [WIDTH - MARGIN.right, HEIGHT - MARGIN.bottom],
    ])({
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      total: node.total,
    })),
    links: graph.links.map((link) => ({
      source: link.source,
      target: link.target,
      value: link.value,
    })),
  });

  const nodes = laid.nodes.flatMap((node): PlacedNode[] => {
    const { x0, x1, y0, y1 } = node;
    if (!finite(x0) || !finite(x1) || !finite(y0) || !finite(y1)) return [];
    return [
      {
        id: node.id,
        label: node.label,
        kind: node.kind,
        total: node.total,
        x0,
        x1,
        y0,
        y1,
      },
    ];
  });

  const toPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>();
  const links = laid.links.flatMap((link): PlacedLink[] => {
    const source = typeof link.source === "object" ? link.source : undefined;
    const target = typeof link.target === "object" ? link.target : undefined;
    if (source === undefined || target === undefined) return [];
    if (!finite(link.width)) return [];
    const d = toPath(link);
    if (d === null) return [];
    return [
      {
        id: linkKey(source.id, target.id),
        source: source.id,
        target: target.id,
        d,
        width: link.width,
        targetKind: target.kind,
        header: `${source.label} → ${target.label}`,
        value: link.value,
      },
    ];
  });

  return { nodes, links };
};

interface LabelPlace {
  readonly x: (node: PlacedNode) => number;
  readonly y: (node: PlacedNode) => number;
  readonly textAnchor: "start" | "middle" | "end";
  readonly dominantBaseline: "auto" | "middle";
}

const BESIDE_RIGHT: LabelPlace = {
  x: (node) => node.x1 + LABEL_GAP,
  y: centerOf,
  textAnchor: "start",
  dominantBaseline: "middle",
};

const LABEL_PLACE: Record<NodeKind, LabelPlace> = {
  income: {
    x: (node) => node.x0 - LABEL_GAP,
    y: centerOf,
    textAnchor: "end",
    dominantBaseline: "middle",
  },
  hub: {
    x: (node) => (node.x0 + node.x1) / 2,
    y: (node) => node.y0 - LABEL_GAP,
    textAnchor: "middle",
    dominantBaseline: "auto",
  },
  category: BESIDE_RIGHT,
  outcome: BESIDE_RIGHT,
};

function NodeLabel({
  node,
  type,
  lit,
}: {
  node: LabelledNode;
  type: TypeSizes;
  lit: boolean;
}) {
  if (node.mark === "none") return null;

  const place = LABEL_PLACE[node.kind];
  const shared = {
    x: place.x(node),
    y: place.y(node),
    textAnchor: place.textAnchor,
    dominantBaseline: place.dominantBaseline,
  };

  if (node.mark === "marker") {
    return (
      <text
        {...shared}
        className={lit ? "fill-foreground" : "fill-muted-foreground"}
        style={{ fontSize: type.marker }}
      >
        {node.note}
      </text>
    );
  }

  return (
    <text
      {...shared}
      className={LABEL_TONE[node.kind]}
      style={{ fontSize: type.name }}
    >
      {node.name}{" "}
      <tspan
        className={lit ? "fill-foreground" : "fill-muted-foreground"}
        style={{ fontSize: type.value }}
      >
        {node.value}
      </tspan>
    </text>
  );
}

interface Hot {
  readonly id: string;
  readonly kind: "node" | "link";
  readonly x: number;
  readonly y: number;
}

/** A ribbon is lit by the cursor on it, or on a node at either end of it. */
const touches = (link: PlacedLink, hot: Hot) =>
  hot.kind === "link"
    ? link.id === hot.id
    : link.source === hot.id || link.target === hot.id;

const opacityOf = (link: PlacedLink, hot: Hot | null) => {
  const tone = LINK_TONE[link.targetKind];
  if (hot === null) return tone.rest;
  return touches(link, hot) ? tone.lit : DIM;
};

const scaleOf = (width: number, height: number) =>
  // `meet` fits to the smaller axis; quantizing stops per-pixel re-layouts.
  Math.max(Math.round(Math.min(width / WIDTH, height / HEIGHT) * 20) / 20, 0.2);

// The legend's box comes from its text (Geist Mono's fixed advance), not a measurement.
const LEGEND = { size: 11, line: 16.5, gapX: 12, gapY: 2, padX: 8, top: 4 };

const LEGEND_STYLE: React.CSSProperties = {
  fontSize: LEGEND.size,
  lineHeight: `${LEGEND.line}px`,
  columnGap: LEGEND.gapX,
  rowGap: LEGEND.gapY,
  paddingInline: LEGEND.padX,
  paddingTop: LEGEND.top,
};

/** An entry wider than the list shrinks to it and wraps between words. */
const linesOf = (text: string, room: number) => {
  const [first = "", ...rest] = text.split(" ");
  const space = widthOf(" ", LEGEND.size);
  return rest.reduce(
    ({ lines, used }, word) => {
      const width = widthOf(word, LEGEND.size);
      return used + space + width <= room
        ? { lines, used: used + space + width }
        : { lines: lines + 1, used: width };
    },
    { lines: 1, used: widthOf(first, LEGEND.size) },
  ).lines;
};

export const legendHeight = (items: readonly string[], width: number) => {
  const room = width - 2 * LEGEND.padX;
  const { rows } = items.reduce<{ rows: readonly number[]; used: number }>(
    ({ rows, used }, text) => {
      const itemWidth = widthOf(text, LEGEND.size);
      if (rows.length > 0 && used + LEGEND.gapX + itemWidth <= room) {
        return { rows, used: used + LEGEND.gapX + itemWidth };
      }
      const lines = itemWidth > room ? linesOf(text, room) : 1;
      return { rows: [...rows, lines], used: Math.min(itemWidth, room) };
    },
    { rows: [], used: 0 },
  );
  if (rows.length === 0) return 0;
  return LEGEND.top + sum(rows) * LEGEND.line + (rows.length - 1) * LEGEND.gapY;
};

/** The legend's entries as it prints them, the pane's note first. */
const legendOf = (note: string | undefined, notes: readonly Note[]) =>
  compact([
    note,
    ...notes.map((item) =>
      compact([item.glyph, item.label, item.value]).join(" "),
    ),
  ]);

/**
 * The legend and the scale size each other, so each step takes the scale the plot
 * would have beside the last step's legend; a cycle settles on its smallest scale.
 */
export const fitScale = (
  frame: ChartSize,
  legendAt: (scale: number) => number,
): number => {
  const step = (scale: number, seen: readonly number[]): number => {
    const next = scaleOf(
      quantize(frame.w),
      quantize(frame.h - legendAt(scale)),
    );
    if (next === scale) return scale;
    if (!seen.includes(next)) return step(next, [...seen, next]);
    return Math.min(...seen.slice(seen.indexOf(next)));
  };
  return step(ASSUMED_SCALE, [ASSUMED_SCALE]);
};

export function Sankey({
  graph,
  note,
  expanded = false,
}: {
  graph: FlowGraph;
  note?: string;
  /** Trades ribbon width for label room; the full-screen view can afford it. */
  expanded?: boolean;
}) {
  const { ref, size } = useChartSize();
  // The frame holds the plot and the legend both, so the legend cannot move it.
  const { ref: frameRef, size: frame } = useChartSize(identity);
  const [hot, setHot] = useState<Hot | null>(null);
  const box = useRef<DOMRect | null>(null);

  const { nodes, links } = useMemo(() => buildLayout(graph), [graph]);
  const nameMax = expanded ? EXPANDED_NAME_MAX : NAME_MAX;
  const scale = useMemo(() => {
    if (frame === null) return ASSUMED_SCALE;
    const legendAt = (candidate: number) =>
      legendHeight(
        legendOf(note, placeLabels(nodes, nameMax, typeFor(candidate)).notes),
        frame.w,
      );
    return fitScale(frame, legendAt);
  }, [frame, nodes, nameMax, note]);
  const type = useMemo(() => typeFor(scale), [scale]);
  const { labelled, notes } = useMemo(
    () => placeLabels(nodes, nameMax, type),
    [nodes, nameMax, type],
  );

  // Not `??=`: the React Compiler skips any component that uses it.
  const boxOf = () => {
    const rect = box.current ?? ref.current?.getBoundingClientRect() ?? null;
    box.current = rect;
    return rect;
  };

  const at = (clientX: number, clientY: number) => {
    const rect = boxOf();
    if (rect === null) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const enter =
    (id: string, kind: Hot["kind"]) => (event: React.PointerEvent) =>
      setHot({ id, kind, ...at(event.clientX, event.clientY) });

  // Focus can land without a pointer visit, so there is no cached box; measure.
  const focus = (id: string) => (event: React.FocusEvent<SVGRectElement>) => {
    const plot = ref.current?.getBoundingClientRect();
    const mark = event.currentTarget.getBoundingClientRect();
    setHot({
      id,
      kind: "node",
      x: mark.right - (plot?.left ?? 0),
      y: (mark.top + mark.bottom) / 2 - (plot?.top ?? 0),
    });
  };

  const hub = labelled.find((node) => node.kind === "hub");
  const hotNode = labelled.find(
    (node) => hot?.kind === "node" && node.id === hot.id,
  );
  const hotLink = links.find(
    (link) => hot?.kind === "link" && link.id === hot.id,
  );

  const tipRows = (): readonly TipRow[] => {
    if (hotLink !== undefined) {
      return [
        { key: "value", label: "per month", value: formatThb(hotLink.value) },
      ];
    }
    if (hotNode === undefined) return [];
    const hasShare =
      hotNode.kind === "category" && hub !== undefined && hub.total > 0;
    return compact([
      { key: "total", label: "per month", value: formatThb(hotNode.total) },
      hasShare && {
        key: "share",
        label: `of ${hub.label.toLowerCase()}`,
        value: formatPercent(hotNode.total / hub.total),
      },
    ]);
  };

  return (
    <div
      ref={frameRef}
      className="flex min-h-0 flex-1 flex-col"
      data-chart="sankey"
    >
      <div
        ref={ref}
        className="relative min-h-0 flex-1"
        onPointerEnter={(event) => {
          box.current = event.currentTarget.getBoundingClientRect();
        }}
        onPointerLeave={() => {
          box.current = null;
          setHot(null);
        }}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full"
          role="group"
          aria-label="Sankey diagram of monthly income flowing into spending categories and savings"
        >
          <g fill="none">
            {links.map((link) => (
              <path
                key={link.id}
                d={link.d}
                stroke={LINK_TONE[link.targetKind].stroke}
                strokeWidth={link.width}
                strokeOpacity={opacityOf(link, hot)}
                className="transition-[stroke-opacity] duration-150"
              />
            ))}
          </g>

          {/* A transparent twin gives every hairline ribbon the same reach. */}
          <g
            fill="none"
            stroke="transparent"
            pointerEvents="stroke"
            className="cursor-crosshair"
          >
            {links.map((link) => (
              <path
                key={link.id}
                d={link.d}
                strokeWidth={Math.max(link.width, HIT_WIDTH)}
                onPointerEnter={enter(link.id, "link")}
                onPointerLeave={() => setHot(null)}
              />
            ))}
          </g>

          <g>
            {labelled.map((node) => (
              <rect
                key={node.id}
                x={node.x0}
                y={node.y0}
                width={node.x1 - node.x0}
                height={Math.max(node.y1 - node.y0, 1)}
                rx={2}
                fill={NODE_FILL[node.kind]}
              />
            ))}
          </g>

          <g fill="transparent" className="cursor-crosshair">
            {labelled.map((node) => {
              const height = Math.max(node.y1 - node.y0, HIT_HEIGHT);
              return (
                <rect
                  key={node.id}
                  x={node.x0}
                  y={centerOf(node) - height / 2}
                  width={node.x1 - node.x0}
                  height={height}
                  tabIndex={0}
                  role="img"
                  aria-label={`${node.label}, ${formatThb(node.total)} per month`}
                  className="focus-visible:outline-ring outline-none focus-visible:outline-1 focus-visible:outline-solid"
                  onPointerEnter={enter(node.id, "node")}
                  onPointerLeave={() => setHot(null)}
                  onFocus={focus(node.id)}
                  onBlur={() => setHot(null)}
                />
              );
            })}
          </g>

          {/* The hit rects above already carry every label as their accessible name. */}
          <g aria-hidden pointerEvents="none">
            {labelled.map((node) => (
              <NodeLabel
                key={node.id}
                node={node}
                type={type}
                lit={hot?.id === node.id}
              />
            ))}
          </g>
        </svg>

        {hot === null || size === null ? null : (
          <ChartTip
            header={hotLink?.header ?? hotNode?.label}
            rows={tipRows()}
            style={tipPlacement(hot.x, hot.y, size.w, size.h)}
          />
        )}
      </div>

      {notes.length === 0 && note === undefined ? null : (
        <ul
          data-slot="flow-notes"
          className="text-muted-foreground flex shrink-0 flex-wrap tabular-nums"
          style={LEGEND_STYLE}
        >
          {note === undefined ? null : <li>{note}</li>}
          {notes.map((item) => (
            <li key={item.id}>
              {item.glyph === UNMARKED ? null : (
                <span className="text-foreground">{item.glyph} </span>
              )}
              {item.label} <span className="text-foreground">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
