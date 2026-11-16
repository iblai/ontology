"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { GraphView } from "@/lib/view/types";
import { cn } from "@/lib/utils";

export type GraphNode = {
  id: string;
  name: string;
  kind: "t" | "s";
  src: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  show: boolean;
};
type Edge = { key: string; a: GraphNode; b: GraphNode; kind: "fk" | "map" | "tl"; show: boolean };
export type Layer = "both" | "data" | "sem";

export type GraphHandle = {
  reveal: (pred: (n: GraphNode) => boolean, perMs: number) => Promise<void>;
  reset: () => void;
  counts: () => { t: number; s: number; e: number };
};

type Graph = {
  nodes: GraphNode[];
  edges: Edge[];
  sources: GraphView["sources"];
  centers: Record<string, [number, number]>;
};

// The first four clusters sit where the mocked map put sis, lms, crm and finance.
const SLOTS: [number, number][] = [
  [0.28, 0.5],
  [0.72, 0.3],
  [0.72, 0.72],
  [0.42, 0.84],
];
const slot = (i: number): [number, number] =>
  SLOTS[i] ?? [0.5 + 0.3 * Math.cos(i * 2.4), 0.5 + 0.3 * Math.sin(i * 2.4)];
const MIDDLE: [number, number] = [0.5, 0.5];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The cluster glow appends an alpha byte, which only a six-digit hex colour takes.
const hex6 = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#64748b");

/** Brings the graph in line with `data`: new nodes are placed, placed nodes keep their place. */
function merge(g: Graph, data: GraphView, W: number, H: number) {
  g.sources = data.sources;
  g.centers = Object.fromEntries(data.sources.map((s, i) => [s.key, slot(i)]));
  const old = new Map(g.nodes.map((n) => [`${n.kind}:${n.id}`, n]));
  const byId = new Map<string, GraphNode>();
  const place = (
    id: string,
    name: string,
    kind: GraphNode["kind"],
    src: string,
    near?: GraphNode,
  ) => {
    const key = `${kind}:${id}`;
    let n = old.get(key);
    if (n) {
      n.name = name;
      n.src = src;
    } else {
      const c = g.centers[src] ?? MIDDLE;
      n = {
        id,
        name,
        kind,
        src,
        x: near ? near.x + (Math.random() - 0.5) * 60 : c[0] * W + (Math.random() - 0.5) * 160,
        y: near ? near.y + (Math.random() - 0.5) * 60 : c[1] * H + (Math.random() - 0.5) * 120,
        vx: 0,
        vy: 0,
        r: kind === "t" ? 9 : 13,
        show: false,
      };
    }
    byId.set(key, n);
  };
  for (const t of data.tables) place(t.id, t.name, "t", t.src);
  for (const t of data.terms) {
    const first = t.maps.map((m) => byId.get(`t:${m}`)).find((n) => n !== undefined);
    place(t.id, t.name, "s", first?.src ?? "", first);
  }
  g.nodes = [...byId.values()];

  const oldEdges = new Map(g.edges.map((e) => [e.key, e]));
  const edges: Edge[] = [];
  const link = (kind: Edge["kind"], a?: GraphNode, b?: GraphNode) => {
    if (!a || !b) return;
    const key = `${kind}:${a.id}:${b.id}`;
    const e = oldEdges.get(key);
    edges.push(e ?? { key, a, b, kind, show: a.show && b.show });
  };
  for (const [a, b] of data.foreignKeys) link("fk", byId.get(`t:${a}`), byId.get(`t:${b}`));
  for (const t of data.terms)
    for (const m of t.maps) link("map", byId.get(`s:${t.id}`), byId.get(`t:${m}`));
  for (const [a, b] of data.termLinks) link("tl", byId.get(`s:${a}`), byId.get(`s:${b}`));
  g.edges = edges;
}

export const OntologyGraph = forwardRef<
  GraphHandle,
  {
    data: GraphView;
    layer: Layer;
    onSelect: (n: GraphNode | null) => void;
    className?: string;
  }
>(function OntologyGraph({ data, layer, onSelect, className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const state = useRef({
    hover: null as GraphNode | null,
    sel: null as GraphNode | null,
    drag: null as GraphNode | null,
    W: 800,
    H: 600,
    counts: { t: 0, s: 0, e: 0 },
  });
  const g = useRef<Graph | null>(null);
  if (!g.current) {
    g.current = { nodes: [], edges: [], sources: [], centers: {} };
    merge(g.current, data, 800, 600);
  }
  const resets = useRef(0); // a reveal still running stops when the graph is reset
  const layerRef = useRef<Layer>(layer);
  const [, force] = useState(0);
  layerRef.current = layer;

  useEffect(() => {
    const gr = g.current!;
    const st = state.current;
    merge(gr, data, st.W, st.H);
    if (st.hover && !gr.nodes.includes(st.hover)) st.hover = null;
    if (st.sel && !gr.nodes.includes(st.sel)) st.sel = null;
    // in place, so a reveal that is running keeps counting into the same object
    Object.assign(st.counts, {
      t: gr.nodes.filter((n) => n.show && n.kind === "t").length,
      s: gr.nodes.filter((n) => n.show && n.kind === "s").length,
      e: gr.edges.filter((e) => e.show).length,
    });
    force((x) => x + 1);
  }, [data]);

  useImperativeHandle(ref, () => ({
    async reveal(pred, perMs) {
      const gr = g.current!;
      const run = resets.current;
      for (const n of gr.nodes) {
        if (resets.current !== run) return;
        if (n.show || !pred(n)) continue;
        const c = state.current.counts;
        n.show = true;
        if (n.kind === "t") c.t++;
        else c.s++;
        for (const e of gr.edges)
          if (!e.show && e.a.show && e.b.show) {
            e.show = true;
            c.e++;
          }
        force((x) => x + 1);
        await sleep(perMs);
      }
    },
    reset() {
      resets.current++;
      g.current!.nodes.forEach((n) => (n.show = false));
      g.current!.edges.forEach((e) => (e.show = false));
      state.current.counts = { t: 0, s: 0, e: 0 };
      state.current.sel = null;
      force((x) => x + 1);
    },
    counts: () => state.current.counts,
  }));

  useEffect(() => {
    const canvas = canvasRef.current!;
    const box = boxRef.current!;
    const ctx = canvas.getContext("2d")!;
    const st = state.current;
    const gr = g.current!;
    let raf = 0;
    let DPR = 1;

    const resize = () => {
      const r = box.getBoundingClientRect();
      DPR = Math.min(2, window.devicePixelRatio || 1);
      st.W = r.width;
      st.H = r.height;
      canvas.width = st.W * DPR;
      canvas.height = st.H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    resize();

    const vis = (n: GraphNode) =>
      n.show &&
      (layerRef.current === "both" ||
        (layerRef.current === "data" && n.kind === "t") ||
        (layerRef.current === "sem" && n.kind === "s"));
    const evis = (e: Edge) =>
      e.show &&
      (layerRef.current === "both"
        ? true
        : layerRef.current === "data"
          ? e.kind === "fk"
          : e.kind === "tl");

    const step = () => {
      const { W, H } = st;
      const vn = gr.nodes.filter(vis);
      for (const n of vn) {
        if (n === st.drag) continue;
        const c = gr.centers[n.src] ?? MIDDLE;
        n.vx += (c[0] * W - n.x) * 0.0035;
        n.vy += (c[1] * H - n.y) * 0.0035;
        n.vx += (W / 2 - n.x) * 0.0006;
        n.vy += (H / 2 - n.y) * 0.0006;
      }
      for (let i = 0; i < vn.length; i++)
        for (let j = i + 1; j < vn.length; j++) {
          const a = vn[i],
            b = vn[j];
          let dx = b.x - a.x,
            dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const min = (a.r + b.r) * 2.6;
          if (d2 < min * min * 4) {
            const d = Math.sqrt(d2);
            const f = ((min * min) / d2) * 0.9;
            dx /= d;
            dy /= d;
            a.vx -= dx * f;
            a.vy -= dy * f;
            b.vx += dx * f;
            b.vy += dy * f;
          }
        }
      for (const e of gr.edges) {
        if (!evis(e)) continue;
        const a = e.a,
          b = e.b;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const L = e.kind === "map" ? 48 : e.kind === "tl" ? 120 : 80;
        const k = e.kind === "map" ? 0.05 : 0.018;
        const f = (d - L) * k;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
      for (const n of vn) {
        if (n === st.drag) continue;
        n.vx *= 0.82;
        n.vy *= 0.82;
        n.x += n.vx;
        n.y += n.vy;
        // keep room for the label drawn to the right of each node
        const labelRoom = n.kind === "s" ? 18 + n.name.length * 7.2 : 20;
        n.x = Math.max(20, Math.min(W - labelRoom, n.x));
        n.y = Math.max(44, Math.min(H - 34, n.y));
      }
    };

    const rr = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };
    const FONT = "'Open Sans', ui-sans-serif, system-ui, sans-serif";
    const MONO = "ui-monospace, Menlo, monospace";
    const C = {
      term: "#0058cc",
      glow: "rgba(0,88,204,.28)",
      table: "#64748b",
      tfill: "#ffffff",
      fk: "#94a3b8",
      map: "#00b0ef",
      text: "#1f2937",
      muted: "#616a76",
    };

    const draw = () => {
      const { W, H } = st;
      ctx.clearRect(0, 0, W, H);
      if (st.counts.t > 0) {
        for (const s of gr.sources) {
          const vn = gr.nodes.filter((n) => vis(n) && n.src === s.key);
          if (!vn.length) continue;
          const color = hex6(s.color);
          const cx = vn.reduce((a, n) => a + n.x, 0) / vn.length,
            cy = vn.reduce((a, n) => a + n.y, 0) / vn.length;
          const rad = Math.max(...vn.map((n) => Math.hypot(n.x - cx, n.y - cy))) + 34;
          const grd = ctx.createRadialGradient(cx, cy, rad * 0.3, cx, cy, rad);
          grd.addColorStop(0, color + "1f");
          grd.addColorStop(1, color + "00");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, 7);
          ctx.fill();
          ctx.fillStyle = color;
          ctx.font = "600 10px " + FONT;
          ctx.fillText(s.name.toUpperCase(), cx - rad * 0.5, cy - rad + 14);
        }
      }
      for (const e of gr.edges) {
        if (!evis(e)) continue;
        const a = e.a,
          b = e.b;
        const hi =
          (st.hover && (st.hover === a || st.hover === b)) ||
          (st.sel && (st.sel === a || st.sel === b));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (e.kind === "fk") {
          ctx.strokeStyle = C.fk;
          ctx.globalAlpha = hi ? 1 : 0.6;
          ctx.lineWidth = hi ? 1.6 : 1;
          ctx.setLineDash([]);
        } else if (e.kind === "map") {
          ctx.strokeStyle = C.map;
          ctx.globalAlpha = hi ? 1 : 0.6;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
        } else {
          ctx.strokeStyle = C.term;
          ctx.globalAlpha = hi ? 1 : 0.55;
          ctx.lineWidth = hi ? 2 : 1.4;
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      for (const n of gr.nodes) {
        if (!vis(n)) continue;
        const hi = n === st.hover || n === st.sel;
        if (n.kind === "t") {
          ctx.fillStyle = C.tfill;
          ctx.strokeStyle = hi ? C.term : C.table;
          ctx.lineWidth = hi ? 2 : 1.3;
          rr(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2, 3);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = hi ? C.term : C.table;
          ctx.globalAlpha = 0.9;
          rr(n.x - n.r + 4, n.y - n.r + 4, n.r * 2 - 8, n.r * 2 - 8, 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          if (hi || layerRef.current === "data" || W > 900) {
            ctx.fillStyle = hi ? C.text : C.muted;
            ctx.font = (hi ? "600 " : "400 ") + "10.5px " + MONO;
            ctx.fillText(n.name, n.x + n.r + 5, n.y + 3.5);
          }
        } else {
          ctx.shadowColor = C.glow;
          ctx.shadowBlur = hi ? 28 : 16;
          ctx.fillStyle = C.term;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, 7);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = "#fff";
          ctx.font = "700 11px " + FONT;
          ctx.textAlign = "center";
          ctx.fillText(n.name.slice(0, 1), n.x, n.y + 4);
          ctx.textAlign = "left";
          ctx.fillStyle = C.text;
          ctx.font = "600 12px " + FONT;
          ctx.fillText(n.name, n.x + n.r + 6, n.y + 4);
        }
      }
    };

    const loop = () => {
      step();
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const pick = (x: number, y: number) => {
      let best: GraphNode | null = null,
        bd = 1e9;
      for (const n of gr.nodes) {
        if (!vis(n)) continue;
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < n.r + 6 && d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    };
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = pos(e);
      if (st.drag) {
        st.drag.x = x;
        st.drag.y = y;
        st.drag.vx = st.drag.vy = 0;
        return;
      }
      st.hover = pick(x, y);
      canvas.style.cursor = st.hover ? "pointer" : "default";
    };
    const onDown = (e: PointerEvent) => {
      const [x, y] = pos(e);
      st.drag = pick(x, y);
      if (st.drag) canvas.setPointerCapture(e.pointerId);
    };
    const onUp = () => {
      if (st.drag) {
        st.sel = st.drag;
        onSelect(st.sel);
      }
      st.drag = null;
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={boxRef}
      className={cn(
        "relative overflow-hidden rounded-[10px] border border-[var(--border-color)] bg-[radial-gradient(900px_500px_at_55%_45%,rgba(0,176,239,.07),transparent_60%),#fafbfc]",
        className,
      )}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
});
