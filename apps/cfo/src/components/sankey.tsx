"use client";

import { useMemo, useRef, useState } from "react";
import { sankey, sankeyLinkHorizontal } from "d3-sankey";
import { groupBy, orderBy } from "es-toolkit";

import type { TipRow } from "~/components/charts/tooltip";
import type { FlowGraph, NodeKind } from "~/domain/flows/types";
import { useChartSize } from "~/components/charts/frame";
import { ChartTip, tipPlacement } from "~/components/charts/tooltip";
import { formatPercent, formatThb, formatThbCompact } from "~/domain/format";

const WIDTH = 960;
const HEIGHT = 500;
/**
 * The side margins are the label columns; a narrower margin clips names instead.
 * They hold at one width in both views: expanded, the labels shrink against the
 * viewBox faster than the gutter does, so the same gutter seats longer names
 * without the ribbons paying for it.
 */
const MARGIN = { top: 26, right: 220, bottom: 14, left: 220 };
const NODE_WIDTH = 14;
const NODE_PADDING = 12;
const LABEL_GAP = 8;

/** A ribbon thinner than this is still a ribbon the pointer has to be able to find. */
const HIT_WIDTH = 12;
const HIT_HEIGHT = 16;

/**
 * Labels hold near the app's own type size no matter how the viewBox scales:
 * the measured render scale is countered, then curved back in slightly so a
 * bigger diagram reads a touch bigger rather than proportionally bigger.
 */
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

/**
 * Colour marks the role a node plays — money in, money out, money kept — never
 * its rank. A rank-based highlight would repaint a different node mid-drag.
 */
const NODE_FILL: Record<NodeKind, string> = {
  income: FOREGROUND,
  hub: FOREGROUND,
  category: MUTED,
  outcome: ACCENT,
};

/**
 * Neutral ribbons stay recessive so the accent "kept" flow reads first; on the
 * dark canvas the accent carries its own contrast and needs no outline. `dim`
 * is what everything the cursor did not pick falls back to.
 */
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

const LABEL_ANCHOR: Record<NodeKind, "start" | "middle" | "end"> = {
  income: "end",
  hub: "middle",
  category: "start",
  outcome: "start",
};

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
  /** The glyph drawn beside the node, or a dot where the column drew none. */
  readonly glyph: string;
  readonly label: string;
  readonly value: string;
}

/**
 * A node too crowded even for a number is listed with no prefix at all: the
 * app spends `·` joining clauses, so a dot here would read as a separator.
 */
const UNMARKED = "";

interface PlacedLink {
  readonly id: string;
  readonly d: string;
  readonly width: number;
  readonly targetKind: NodeKind;
  readonly header: string;
  readonly value: number;
}

const linkKey = (source: string, target: string) => `${source}->${target}`;

const finite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

const widthOf = (text: string, size: number) => text.length * size * CHAR;

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

/**
 * Labels are placed greedily down each column: a node whose neighbour left it
 * room keeps its name, one that did not gets a number, and one with room for
 * neither is only listed. Everything that lost its name is listed either way,
 * so no figure is reachable by hover alone.
 */
const placeLabels = (
  nodes: readonly PlacedNode[],
  nameMax: number,
  type: TypeSizes,
) => {
  const columns = orderBy(
    Object.entries(groupBy(nodes, (node) => String(Math.round(node.x0)))),
    [([x]) => Number(x)],
    ["asc"],
  );

  const notes: Note[] = [];
  const labelled: LabelledNode[] = [];
  // Counted apart from the strip's length: only a node the diagram draws a
  // number beside may claim one, so every printed number has something to find.
  let numbered = 0;

  for (const [, column] of columns) {
    let cursor = -Infinity;
    for (const node of orderBy(column, [centerOf], ["asc"])) {
      const mark = markFor(centerOf(node) - cursor, type);
      if (mark !== "none") cursor = centerOf(node);

      const value = formatThbCompact(node.total);
      if (mark === "marker") numbered += 1;
      const note = mark === "marker" ? numbered : 0;
      if (mark !== "label") {
        notes.push({
          id: node.id,
          glyph: note > 0 ? String(note) : UNMARKED,
          label: node.label,
          value: formatThb(node.total),
        });
      }
      labelled.push({
        ...node,
        name: truncate(node.label, value, nameMax, type),
        value,
        mark,
        note,
      });
    }
  }

  return { labelled, notes };
};

const buildLayout = (graph: FlowGraph, expanded: boolean, type: TypeSizes) => {
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
  /** Which ribbons a node touches, so hovering one can lift exactly those. */
  const incident = new Map<string, Set<string>>();
  const touch = (nodeId: string, linkId: string) => {
    const set = incident.get(nodeId) ?? new Set<string>();
    set.add(linkId);
    incident.set(nodeId, set);
  };

  const links = laid.links.flatMap((link): PlacedLink[] => {
    const source = typeof link.source === "object" ? link.source : undefined;
    const target = typeof link.target === "object" ? link.target : undefined;
    if (source === undefined || target === undefined) return [];
    if (!finite(link.width)) return [];
    const d = toPath(link);
    if (d === null) return [];
    const id = linkKey(source.id, target.id);
    touch(source.id, id);
    touch(target.id, id);
    return [
      {
        id,
        d,
        width: link.width,
        targetKind: target.kind,
        header: `${source.label} → ${target.label}`,
        value: link.value,
      },
    ];
  });

  const nameMax = expanded ? EXPANDED_NAME_MAX : NAME_MAX;
  return { ...placeLabels(nodes, nameMax, type), links, incident };
};

const labelX = (node: PlacedNode) => {
  if (node.kind === "income") return node.x0 - LABEL_GAP;
  if (node.kind === "hub") return (node.x0 + node.x1) / 2;
  return node.x1 + LABEL_GAP;
};

const labelY = (node: PlacedNode) => {
  if (node.kind === "hub") return node.y0 - LABEL_GAP;
  return centerOf(node);
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

  const shared = {
    x: labelX(node),
    y: labelY(node),
    textAnchor: LABEL_ANCHOR[node.kind],
    dominantBaseline:
      node.kind === "hub" ? ("auto" as const) : ("middle" as const),
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

const scaleOf = (width: number, height: number) =>
  // `meet` fits to the smaller axis; quantizing stops per-pixel re-layouts.
  Math.max(Math.round(Math.min(width / WIDTH, height / HEIGHT) * 20) / 20, 0.2);

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
  const [hot, setHot] = useState<Hot | null>(null);
  const box = useRef<DOMRect | null>(null);

  const scale = size === null ? ASSUMED_SCALE : scaleOf(size.w, size.h);
  const type = useMemo(() => typeFor(scale), [scale]);
  const { labelled, links, notes, incident } = useMemo(
    () => buildLayout(graph, expanded, type),
    [graph, expanded, type],
  );

  const boxOf = () => {
    box.current ??= ref.current?.getBoundingClientRect() ?? null;
    return box.current;
  };

  const at = (clientX: number, clientY: number) => {
    const rect = boxOf();
    if (rect === null) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const enter =
    (id: string, kind: Hot["kind"]) => (event: React.PointerEvent) =>
      setHot({ id, kind, ...at(event.clientX, event.clientY) });

  // Keyboard focus can land without a pointer ever entering, so there is no
  // cached box to trust — measure directly instead.
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

  const litLinks =
    hot === null
      ? null
      : hot.kind === "link"
        ? new Set([hot.id])
        : (incident.get(hot.id) ?? new Set<string>());

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
    const rows: TipRow[] = [
      { key: "total", label: "per month", value: formatThb(hotNode.total) },
    ];
    if (hotNode.kind === "category" && hub !== undefined && hub.total > 0) {
      rows.push({
        key: "share",
        label: `of ${hub.label.toLowerCase()}`,
        value: formatPercent(hotNode.total / hub.total),
      });
    }
    return rows;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-chart="sankey">
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
                strokeOpacity={
                  litLinks === null
                    ? LINK_TONE[link.targetKind].rest
                    : litLinks.has(link.id)
                      ? LINK_TONE[link.targetKind].lit
                      : DIM
                }
                className="transition-[stroke-opacity] duration-150"
              />
            ))}
          </g>

          {/* A hairline ribbon is unhittable; the twin gives every one of them
              the same reach without widening what is drawn. */}
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
                  className="focus-visible:outline-ring outline-none focus-visible:outline-1"
                  onPointerEnter={enter(node.id, "node")}
                  onPointerLeave={() => setHot(null)}
                  onFocus={focus(node.id)}
                  onBlur={() => setHot(null)}
                />
              );
            })}
          </g>

          {/* The hit rects above already carry every label as their accessible
              name, and they are what a pointer and a tab both land on. */}
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
          className="text-muted-foreground flex shrink-0 flex-wrap gap-x-3 gap-y-0.5 px-2 pt-1 text-[11px] tabular-nums"
        >
          {note === undefined ? null : <li>{note}</li>}
          {notes.map((item) => (
            <li key={item.id}>
              {item.glyph === "" ? null : (
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
