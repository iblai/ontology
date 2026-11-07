import type { GraphData, GraphLinkKind, GraphNode, Role } from "./types";
import { endId } from "./graph";

export type FlowKind =
  | "service"
  | "source"
  | "memory_domain"
  | "tool"
  | "toolset"
  | "role"
  | "agent";
/** Synthetic edges: a role runs an agent; a service's tables fill a memory domain (its entity group). */
export type FlowEdgeKind = GraphLinkKind | "assigned" | "syncs";
export type FlowUnit = "records" | "tools" | "toolsets" | "roles";

/** Left to right: where data comes from, what the ontology holds, what acts on it, who may. */
export const COLUMNS: FlowKind[][] = [
  ["service"],
  ["source", "memory_domain"],
  ["tool"],
  ["toolset"],
  ["role"],
  ["agent"],
];
export const CARD = { w: 208, h: 68, colGap: 80, rowGap: 20, padX: 24, padY: 44 } as const;

export interface FlowCard {
  id: string;
  kind: FlowKind;
  label: string;
  /** A free-text fact (adapter, type) … */
  fact?: string;
  /** … or a count the page renders with its unit. */
  count?: { n: number; unit: FlowUnit };
  col: number;
  row: number;
  x: number;
  y: number;
}

export interface FlowEdge {
  id: string;
  kind: FlowEdgeKind;
  /** Graph direction, whichever side each card sits on. */
  source: string;
  target: string;
  wildcard?: boolean;
  d: string;
  /** Where a label sits: the first vertical run's midpoint. */
  lx: number;
  ly: number;
}

export interface FlowLayout {
  cards: FlowCard[];
  edges: FlowEdge[];
  width: number;
  height: number;
}

type Seed = Omit<FlowCard, "col" | "row" | "x" | "y">;

const COL_OF = new Map<FlowKind, number>();
COLUMNS.forEach((kinds, col) => kinds.forEach((k) => COL_OF.set(k, col)));

export const colX = (col: number) => CARD.padX + col * (CARD.w + CARD.colGap);
export const rowY = (row: number) => CARD.padY + row * (CARD.h + CARD.rowGap);
/** The midpoint of the gap after a column: every vertical run lives there. */
const gapX = (col: number) => colX(col) + CARD.w + CARD.colGap / 2;

/** Orthogonal points from the left card to the right one; horizontals stay in gaps or row corridors. */
export function routePoints(left: FlowCard, right: FlowCard): [number, number][] {
  const x1 = left.x + CARD.w;
  const y1 = left.y + CARD.h / 2;
  const x2 = right.x;
  const y2 = right.y + CARD.h / 2;
  const g1 = gapX(left.col);
  if (right.col === left.col + 1)
    return [
      [x1, y1],
      [g1, y1],
      [g1, y2],
      [x2, y2],
    ];
  const corridor = rowY(right.row) - CARD.rowGap / 2;
  const g2 = gapX(right.col - 1);
  return [
    [x1, y1],
    [g1, y1],
    [g1, corridor],
    [g2, corridor],
    [g2, y2],
    [x2, y2],
  ];
}

/** An SVG path through orthogonal points with rounded corners. */
export function elbow(points: [number, number][], r = 6): string {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const rr = Math.min(r, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    if (rr <= 0) continue;
    const ax = cx - Math.sign(cx - px) * rr;
    const ay = cy - Math.sign(cy - py) * rr;
    const bx = cx + Math.sign(nx - cx) * rr;
    const by = cy + Math.sign(ny - cy) * rr;
    d += ` L${ax} ${ay} Q${cx} ${cy} ${bx} ${by}`;
  }
  const [ex, ey] = points[points.length - 1];
  return `${d} L${ex} ${ey}`;
}

function factOf(
  n: GraphNode,
  tools: Map<string, number>,
  grants: Map<string, number>,
): Pick<FlowCard, "fact" | "count"> {
  switch (n.kind) {
    case "service":
      return { fact: String(n.meta.adapter ?? "") };
    case "source":
    case "tool":
      return { fact: String(n.meta.type ?? "") };
    case "memory_domain":
      return { count: { n: Number(n.meta.files ?? 0), unit: "records" } };
    case "toolset":
      return { count: { n: tools.get(n.id) ?? 0, unit: "tools" } };
    case "role":
      return { count: { n: grants.get(n.id) ?? 0, unit: "toolsets" } };
    default:
      return {};
  }
}

/** Cards in kind columns on one row grid, and every edge between two cards routed around the rest. */
export function layoutFlow(g: GraphData, roles: Role[]): FlowLayout {
  const outDegree = (kind: GraphLinkKind) => {
    const m = new Map<string, number>();
    for (const l of g.links)
      if (l.kind === kind) m.set(endId(l.source), (m.get(endId(l.source)) ?? 0) + 1);
    return m;
  };
  const tools = outDegree("contains");
  const grants = outDegree("grants");
  const seeds: Seed[] = [];
  for (const n of g.nodes) {
    const kind = n.kind as FlowKind;
    if (COL_OF.has(kind))
      seeds.push({ id: n.id, kind, label: n.label, ...factOf(n, tools, grants) });
  }
  const agentRoles = new Map<string, number>();
  for (const r of roles) for (const a of r.agents) agentRoles.set(a, (agentRoles.get(a) ?? 0) + 1);
  for (const [a, n] of agentRoles)
    seeds.push({ id: `agent:${a}`, kind: "agent", label: a, count: { n, unit: "roles" } });

  const byCol: Seed[][] = COLUMNS.map(() => []);
  for (const s of seeds) byCol[COL_OF.get(s.kind)!].push(s);
  const cards: FlowCard[] = [];
  const byId = new Map<string, FlowCard>();
  byCol.forEach((list, col) => {
    const order = (k: FlowKind) => COLUMNS[col].indexOf(k);
    list.sort((a, b) => order(a.kind) - order(b.kind) || a.label.localeCompare(b.label));
    list.forEach((s, row) => {
      const card = { ...s, col, row, x: colX(col), y: rowY(row) };
      cards.push(card);
      byId.set(card.id, card);
    });
  });

  const edges: FlowEdge[] = [];
  const seen = new Set<string>();
  const add = (kind: FlowEdgeKind, source: string, target: string, wildcard?: boolean) => {
    const a = byId.get(source);
    const b = byId.get(target);
    if (!a || !b || a.col === b.col) return;
    const id = `${kind}:${source}>${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    const [left, right] = a.col < b.col ? [a, b] : [b, a];
    const pts = routePoints(left, right);
    edges.push({
      id,
      kind,
      source,
      target,
      wildcard,
      d: elbow(pts),
      lx: pts[1][0],
      ly: (pts[1][1] + pts[2][1]) / 2,
    });
  };
  for (const l of g.links) add(l.kind, endId(l.source), endId(l.target), l.wildcard);
  for (const r of roles) for (const a of r.agents) add("assigned", `role:${r.name}`, `agent:${a}`);
  const groupOf = new Map<string, string>();
  for (const l of g.links)
    if (l.kind === "in_group")
      groupOf.set(endId(l.source), endId(l.target).slice("entity_group:".length));
  for (const l of g.links) {
    const group = l.kind === "has_table" ? groupOf.get(endId(l.target)) : undefined;
    if (group) add("syncs", endId(l.source), `memory_domain:${group}`);
  }

  const rows = Math.max(0, ...byCol.map((c) => c.length));
  return {
    cards,
    edges,
    width: CARD.padX * 2 + COLUMNS.length * CARD.w + (COLUMNS.length - 1) * CARD.colGap,
    height: CARD.padY + CARD.padX + Math.max(0, rows * (CARD.h + CARD.rowGap) - CARD.rowGap),
  };
}
