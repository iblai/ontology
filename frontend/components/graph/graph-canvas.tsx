"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import type { GraphData, GraphKind, GraphLink, GraphNode } from "@/lib/ontology/types";
import {
  FLOW,
  GRANT,
  KIND_COLORS,
  degrees,
  endId,
  neighbourhood,
  SURFACE,
} from "@/lib/ontology/graph";

type N = NodeObject<GraphNode>;
type L = LinkObject<GraphNode, GraphLink>;

interface CanvasProps {
  data: GraphData;
  hiddenKinds: Set<GraphKind>;
  /** Ids kept bright while a role is focused; null = no focus. */
  emphasis: Set<string> | null;
  /** Ids ringed in the focus colour (what the focused role grants). */
  granted: Set<string>;
  focusColor: string | null;
  issues: boolean;
  selectedId: string | null;
  reduced: boolean;
  /** Bump to zoom the whole graph back into view. */
  fitSignal: number;
  onSelect: (id: string | null) => void;
}

const LEAF: ReadonlySet<GraphKind> = new Set(["column", "memory_record"]);
const RED = "#e66767";
const WHITE = "#f5f5f4";
const FIT_PADDING = 48;
const radius = (kind: GraphKind, d: number) =>
  kind === "memory_domain"
    ? 6 + 1.2 * Math.sqrt(d)
    : LEAF.has(kind)
      ? 1.6 + 0.5 * Math.sqrt(d)
      : 3 + 1.8 * Math.sqrt(d);

/** Keeps dots apart so the cluster breathes and labels get room. */
// ponytail: O(n²) pair loop, fine below ~500 nodes; d3-force-3d's quadtree collide if the graph grows.
function collide(pad: (n: N) => number) {
  let nodes: N[] = [];
  const force = (alpha: number) => {
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const min = pad(a) + pad(b);
        const d2 = dx * dx + dy * dy;
        if (d2 === 0 || d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5 * alpha;
        a.vx = (a.vx ?? 0) - dx * push;
        a.vy = (a.vy ?? 0) - dy * push;
        b.vx = (b.vx ?? 0) + dx * push;
        b.vy = (b.vy ?? 0) + dy * push;
      }
  };
  force.initialize = (ns: N[]) => {
    nodes = ns;
  };
  return force;
}

/** The force graph: dots sized by links, glowing hubs, labels where there is room, particles on sync flows. */
export default function GraphCanvas({
  data,
  hiddenKinds,
  emphasis,
  granted,
  focusColor,
  issues,
  selectedId,
  reduced,
  fitSignal,
  onSelect,
}: CanvasProps) {
  const fg = useRef<ForceGraphMethods<N, L> | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<string | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width && height) setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const degree = useMemo(() => degrees(data.links), [data.links]);
  const hoverSet = useMemo(
    () => (hover ? neighbourhood(data.links, hover, 1) : null),
    [data.links, hover],
  );
  const selectedSet = useMemo(
    () => (selectedId ? neighbourhood(data.links, selectedId, 1) : null),
    [data.links, selectedId],
  );
  const visible = useMemo(() => {
    const ids = new Set<string>();
    for (const n of data.nodes) if (!hiddenKinds.has(n.kind)) ids.add(n.id);
    return ids;
  }, [data.nodes, hiddenKinds]);

  // Forces: short links for leaves, a loose cloud for the rest, no overlaps; refit once per data set.
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force("charge")?.strength(-140);
    g.d3Force("link")?.distance((l: L) => {
      const s = l.source as N;
      const t = l.target as N;
      return LEAF.has(s.kind) || LEAF.has(t.kind) || l.kind === "links" ? 18 : 64;
    });
    g.d3Force(
      "collide",
      collide((n) => radius(n.kind, degree.get(n.id) ?? 0) + 5),
    );
    fitted.current = false;
    g.d3ReheatSimulation();
  }, [data, degree]);

  useEffect(() => {
    if (fitSignal) fg.current?.zoomToFit(reduced ? 0 : 500, FIT_PADDING);
  }, [fitSignal, reduced]);

  useEffect(() => {
    const g = fg.current;
    const node = selectedId ? (data.nodes as N[]).find((n) => n.id === selectedId) : null;
    if (!g || !node || node.x === undefined || node.y === undefined) return;
    g.centerAt(node.x, node.y, reduced ? 0 : 500);
    if (g.zoom() < 2) g.zoom(2, reduced ? 0 : 500);
  }, [selectedId, data.nodes, reduced]);

  const bright = (id: string) => (!emphasis || emphasis.has(id)) && (!hoverSet || hoverSet.has(id));
  const active = hover ?? selectedId;
  const touches = (l: L) => !!active && (endId(l.source) === active || endId(l.target) === active);

  return (
    <div
      ref={box}
      className="absolute inset-0"
      onDoubleClick={() => fg.current?.zoomToFit(reduced ? 0 : 500, FIT_PADDING)}
    >
      <ForceGraph2D
        ref={fg}
        width={size.width}
        height={size.height}
        backgroundColor="rgba(0,0,0,0)"
        graphData={data as { nodes: N[]; links: L[] }}
        nodeVisibility={(n: N) => visible.has(n.id)}
        linkVisibility={(l: L) => visible.has(endId(l.source)) && visible.has(endId(l.target))}
        cooldownTicks={reduced ? 0 : 300}
        warmupTicks={reduced ? 200 : 0}
        d3VelocityDecay={0.25}
        onEngineStop={() => {
          if (fitted.current) return;
          fitted.current = true;
          fg.current?.zoomToFit(reduced ? 0 : 600, FIT_PADDING);
        }}
        nodeCanvasObjectMode={() => "replace"}
        nodeCanvasObject={(n: N, ctx, scale) => {
          const d = degree.get(n.id) ?? 0;
          const hub = n.kind === "memory_domain" || d >= 8;
          const r = radius(n.kind, d);
          const on = bright(n.id);
          const alpha = on ? 1 : 0.12;
          const colour = n.kind === "memory_domain" ? WHITE : KIND_COLORS[n.kind];
          const selected = n.id === selectedId;
          const x = n.x ?? 0;
          const y = n.y ?? 0;
          if (hub || selected) {
            ctx.globalAlpha = alpha * (selected ? 0.3 : 0.16);
            ctx.beginPath();
            ctx.arc(x, y, r * 2.4, 0, 2 * Math.PI);
            ctx.fillStyle = selected ? "#ffffff" : colour;
            ctx.fill();
          }
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, 2 * Math.PI);
          if (n.kind === "missing") {
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1 / scale;
            ctx.stroke();
          } else {
            ctx.fillStyle = colour;
            ctx.fill();
          }
          const ring = selected
            ? "#ffffff"
            : granted.has(n.id) && focusColor
              ? focusColor
              : issues && n.health
                ? RED
                : null;
          if (ring) {
            ctx.beginPath();
            ctx.arc(x, y, r + 2 / scale, 0, 2 * Math.PI);
            ctx.strokeStyle = ring;
            ctx.lineWidth = 1.5 / scale;
            ctx.stroke();
          }
          const near =
            n.id === hover || selected || !!hoverSet?.has(n.id) || !!selectedSet?.has(n.id);
          const showLabel =
            near ||
            n.kind === "memory_domain" ||
            (hub && scale > 0.8) ||
            (scale > 1.8 && !LEAF.has(n.kind)) ||
            scale > 4;
          if (showLabel && on) {
            ctx.font = `${(hub ? 12.5 : 11.5) / scale}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.lineWidth = 3.5 / scale;
            ctx.strokeStyle = SURFACE;
            ctx.strokeText(n.label, x + r + 4 / scale, y);
            ctx.fillStyle = hub || near ? WHITE : "#c7cbd6";
            ctx.fillText(n.label, x + r + 4 / scale, y);
          }
          ctx.globalAlpha = 1;
        }}
        nodePointerAreaPaint={(n: N, paint, ctx) => {
          ctx.fillStyle = paint;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, radius(n.kind, degree.get(n.id) ?? 0) + 3, 0, 2 * Math.PI);
          ctx.fill();
        }}
        linkColor={(l: L) => {
          const s = endId(l.source);
          const t = endId(l.target);
          if (!bright(s) || !bright(t)) return "rgba(255,255,255,0.03)";
          if (focusColor && GRANT.has(l.kind) && emphasis?.has(s)) return `${focusColor}aa`;
          if (touches(l)) return "rgba(255,255,255,0.6)";
          return active ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.14)";
        }}
        linkWidth={(l: L) => (touches(l) ? 1.6 : 1)}
        linkDirectionalParticles={(l: L) => (!reduced && FLOW.has(l.kind) ? 2 : 0)}
        linkDirectionalParticleSpeed={0.004}
        linkDirectionalParticleWidth={2}
        linkDirectionalParticleColor={() => "rgba(255,255,255,0.6)"}
        onNodeHover={(n: N | null) => setHover(n?.id ?? null)}
        onNodeClick={(n: N) => onSelect(n.id)}
        onBackgroundClick={() => onSelect(null)}
        onNodeDragEnd={(n: N) => {
          n.fx = n.x;
          n.fy = n.y;
        }}
      />
    </div>
  );
}
