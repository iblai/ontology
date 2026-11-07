import { beforeEach, describe, expect, it } from "vitest";
import { mockApi } from "./mock/handlers";
import { CARD, COLUMNS, elbow, layoutFlow, routePoints } from "./flow";

beforeEach(() => mockApi.reset());
const layout = () => layoutFlow(mockApi.graph(false), mockApi.roles.list());

describe("layoutFlow", () => {
  it("puts every card in its kind's column, sorted, on one row grid without overlaps", () => {
    const { cards, width, height } = layout();
    expect(cards.length).toBeGreaterThan(10);
    const slots = new Set<string>();
    for (const c of cards) {
      expect(COLUMNS[c.col]).toContain(c.kind);
      expect(c.x).toBe(CARD.padX + c.col * (CARD.w + CARD.colGap));
      expect(c.y).toBe(CARD.padY + c.row * (CARD.h + CARD.rowGap));
      expect(c.x + CARD.w).toBeLessThanOrEqual(width);
      expect(c.y + CARD.h).toBeLessThanOrEqual(height);
      expect(slots.has(`${c.col}:${c.row}`)).toBe(false);
      slots.add(`${c.col}:${c.row}`);
    }
    for (let col = 0; col < COLUMNS.length; col++) {
      const labels = cards
        .filter((c) => c.col === col && c.kind === COLUMNS[col][0])
        .map((c) => c.label);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    }
  });

  it("routes each edge between the cards' facing sides without crossing any card", () => {
    const { cards, edges } = layout();
    expect(edges.length).toBeGreaterThan(10);
    const byId = new Map(cards.map((c) => [c.id, c]));
    for (const e of edges) {
      const a = byId.get(e.source)!;
      const b = byId.get(e.target)!;
      const [l, r] = a.col < b.col ? [a, b] : [b, a];
      const pts = routePoints(l, r);
      expect(pts[0]).toEqual([l.x + CARD.w, l.y + CARD.h / 2]);
      expect(pts[pts.length - 1]).toEqual([r.x, r.y + CARD.h / 2]);
      expect(e.d.startsWith(`M${pts[0][0]} ${pts[0][1]}`)).toBe(true);
      expect(e.d.endsWith(`L${r.x} ${r.y + CARD.h / 2}`)).toBe(true);
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1];
        const [x2, y2] = pts[i];
        expect(x1 === x2 || y1 === y2).toBe(true);
        if (y1 !== y2) continue;
        const lo = Math.min(x1, x2);
        const hi = Math.max(x1, x2);
        for (const c of cards) {
          const crosses = c.x < hi && c.x + CARD.w > lo && c.y < y1 && c.y + CARD.h > y1;
          expect(crosses, `${e.id} crosses ${c.id}`).toBe(false);
        }
      }
    }
  });

  it("adds agent cards with assigned edges and service→domain syncs edges", () => {
    const { cards, edges } = layout();
    expect(cards.find((c) => c.id === "agent:general-info-agent")?.count).toEqual({
      n: 3,
      unit: "roles",
    });
    expect(
      edges.some(
        (e) =>
          e.kind === "assigned" &&
          e.source === "role:Registrar" &&
          e.target === "agent:general-info-agent",
      ),
    ).toBe(true);
    expect(
      edges.some(
        (e) =>
          e.kind === "syncs" &&
          e.source.startsWith("service:") &&
          e.target.startsWith("memory_domain:"),
      ),
    ).toBe(true);
    expect(edges.some((e) => e.kind === "grants" && e.wildcard)).toBe(true);
  });
});

describe("elbow", () => {
  it("draws a straight line without corners and rounds each corner otherwise", () => {
    expect(
      elbow([
        [0, 0],
        [10, 0],
      ]),
    ).toBe("M0 0 L10 0");
    expect(
      elbow(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        4,
      ),
    ).toBe("M0 0 L6 0 Q10 0 10 4 L10 10");
  });
});
