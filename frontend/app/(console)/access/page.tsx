"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { Spinner } from "@iblai/iblai-js/web-containers";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { GraphData, GraphKind, McpToolset, Role } from "@/lib/ontology/types";
import { KIND_COLORS, endId, grantPatch, reach, type ToggleKind } from "@/lib/ontology/graph";
import { CARD, COLUMNS, colX, layoutFlow, type FlowCard } from "@/lib/ontology/flow";
import { SectionHeader } from "@/components/console/section-header";
import { EmptyState } from "@/components/console/empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const EMPTY: GraphData = { nodes: [], links: [], stats: { hubs: [], orphans: 0, dangling: 0 } };
const kindOf = (id: string) => id.split(":")[0] as GraphKind;

export default function AccessPage() {
  const t = useTranslations("access");
  const tg = useTranslations("graph");
  const tc = useTranslations("common");
  const [data, setData] = useState<GraphData | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [toolsets, setToolsets] = useState<McpToolset[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleName, setRoleName] = useState("all");
  const [toolsetName, setToolsetName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([apiClient.graph.get(false), apiClient.roles.list(), apiClient.mcp.toolsets()])
      .then(([g, r, ts]) => {
        if (!live) return;
        if (g.ok === false) toast.error(g.message || tg("loadFailed"));
        setData(g);
        setRoles(r);
        setToolsets(ts);
      })
      .catch((e) => {
        console.error("access load failed", e);
        if (live) toast.error(tg("loadFailed"));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tg]);

  const graph = data ?? EMPTY;
  const flow = useMemo(() => layoutFlow(graph, roles), [graph, roles]);
  const role = roles.find((r) => r.name === roleName) ?? null;
  const toolset = toolsets.find((ts) => ts.name === toolsetName) ?? null;
  // Everything the selected role reaches, plus the agents it runs; null = no focus.
  const lit = useMemo(() => {
    if (!role) return null;
    const set = reach(graph.links, `role:${role.name}`).nodes;
    for (const a of role.agents) set.add(`agent:${a}`);
    return set;
  }, [graph.links, role]);
  // "<link kind>><target id>" for the selected role's direct grants.
  const granted = useMemo(() => {
    const set = new Set<string>();
    if (role)
      for (const l of graph.links)
        if (endId(l.source) === `role:${role.name}`) set.add(`${l.kind}>${endId(l.target)}`);
    return set;
  }, [graph.links, role]);

  async function onGrant(kind: ToggleKind, name: string) {
    if (!role) return;
    const patch = grantPatch(graph, role, kind, name);
    setSaving(true);
    try {
      const r = await apiClient.roles.save(patch.role);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setRoles((rs) => rs.map((x) => (x.name === role.name ? patch.role : x)));
      setData((d) => d && { ...d, links: patch.links });
      toast.success(tg(patch.had ? "revoked" : "granted", { role: role.display_name, name }));
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  }

  async function onMember(tool: string) {
    if (!toolset) return;
    const had = toolset.tools.includes(tool);
    const next = {
      ...toolset,
      tools: had ? toolset.tools.filter((x) => x !== tool) : [...toolset.tools, tool],
    };
    setSaving(true);
    try {
      const r = await apiClient.mcp.saveToolset(next);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setToolsets((ts) => ts.map((x) => (x.name === next.name ? next : x)));
      const source = `toolset:${next.name}`;
      const target = `tool:${tool}`;
      setData((d) => {
        if (!d) return d;
        const links = d.links.filter(
          (l) =>
            !(l.kind === "contains" && endId(l.source) === source && endId(l.target) === target),
        );
        if (!had) links.push({ source, target, kind: "contains" });
        return { ...d, links };
      });
      toast.success(t(had ? "removed" : "added", { tool, toolset: next.name }));
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  }

  const edgeLabel = (kind: string) => (t.has(`edges.${kind}`) ? t(`edges.${kind}`) : kind);

  // A mouse drag pans the chart; wheel, trackpad and touch keep native scrolling.
  const pan = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = pan.current;
    if (!el || e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as Element).closest("button, [role=switch], a, input, select")) return;
    e.preventDefault();
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      moved: false,
    };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = pan.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  }
  function onPointerEnd() {
    drag.current = null;
    setDragging(false);
  }

  /** The switch in a card's top row: a role's toolset grant, or a tool's membership in the picked toolset. */
  function control(card: FlowCard) {
    if (role && card.kind === "toolset")
      return (
        <Switch
          aria-label={t("grant", { name: card.label })}
          checked={granted.has(`grants>${card.id}`)}
          disabled={saving}
          onCheckedChange={() => onGrant("toolset", card.label)}
        />
      );
    if (toolset && card.kind === "tool")
      return (
        <Switch
          aria-label={t("member", { tool: card.label, toolset: toolset.name })}
          checked={toolset.tools.includes(card.label)}
          disabled={saving}
          onCheckedChange={() => onMember(card.label)}
        />
      );
    return null;
  }

  /** A card's bottom row: the fact, or a memory domain's read and cache switches for the role. */
  function detail(card: FlowCard) {
    if (role && card.kind === "memory_domain")
      return (
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          {t("read")}
          <Switch
            aria-label={t("readOf", { name: card.label })}
            checked={granted.has(`reads>${card.id}`)}
            disabled={saving}
            onCheckedChange={() => onGrant("memory_domain", card.label)}
          />
          <span className="ml-1">{t("cache")}</span>
          <Switch
            aria-label={t("cacheOf", { name: card.label })}
            checked={granted.has(`caches>${card.id}`)}
            disabled={saving}
            onCheckedChange={() => onGrant("cache", card.label)}
          />
        </span>
      );
    const text =
      card.fact ?? (card.count ? t(`count.${card.count.unit}`, { n: card.count.n }) : "");
    return <span className="text-muted-foreground truncate font-mono text-[11px]">{text}</span>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-muted-foreground text-xs">{t("role")}</Label>
          <Select value={roleName} onValueChange={setRoleName}>
            <SelectTrigger className="h-9 w-56" aria-label={t("role")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allRoles")}</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {r.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground pb-2 text-xs">
          {toolset
            ? t("hintToolset", { name: toolset.name })
            : role
              ? t("hintRole", { role: role.display_name })
              : t("hint")}
        </p>
      </div>

      {data && flow.cards.length === 0 && !loading ? (
        <EmptyState
          icon={ShieldCheck}
          title={tg("emptyTitle")}
          hint={tg("emptyHint")}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/services/add">{tg("emptyAction")}</Link>
            </Button>
          }
        />
      ) : (
        <div
          ref={pan}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          className={cn(
            "relative min-h-[480px] flex-1 overflow-auto rounded-lg border bg-muted/40 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            dragging ? "cursor-grabbing select-none" : "cursor-grab",
          )}
        >
          <div className="relative" style={{ width: flow.width, height: flow.height }}>
            {COLUMNS.map((kinds, col) => (
              <span
                key={col}
                className="text-muted-foreground absolute top-3 text-[10px] font-medium tracking-wide uppercase"
                style={{ left: colX(col) }}
              >
                {kinds.map((k) => t(`kinds.${k}`)).join(" · ")}
              </span>
            ))}
            <svg
              className="pointer-events-none absolute inset-0"
              width={flow.width}
              height={flow.height}
              aria-hidden
            >
              {flow.edges.map((e) => {
                const on = !lit || (lit.has(e.source) && lit.has(e.target));
                return (
                  <g key={e.id} opacity={on ? 1 : 0.15}>
                    <path
                      d={e.d}
                      fill="none"
                      stroke={KIND_COLORS[kindOf(e.source)] ?? KIND_COLORS.missing}
                      strokeOpacity={lit && on ? 0.9 : 0.45}
                      strokeWidth={lit && on ? 1.5 : 1}
                      strokeDasharray={e.wildcard ? "4 3" : e.kind === "caches" ? "1 3" : undefined}
                    />
                    {lit && on && e.kind !== "caches" && (
                      <text
                        x={e.lx + 4}
                        y={e.ly + 3}
                        className="fill-muted-foreground"
                        fontSize={9}
                        fontFamily="ui-monospace, monospace"
                      >
                        {edgeLabel(e.kind)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {flow.cards.map((card) => {
              const on = !lit || lit.has(card.id);
              // Memory domains are white hubs on the dark map; on paper they take their entity group's green.
              const color =
                KIND_COLORS[
                  card.kind === "agent"
                    ? "role"
                    : card.kind === "memory_domain"
                      ? "entity_group"
                      : card.kind
                ];
              const picked = card.kind === "toolset" && toolsetName === card.label;
              return (
                <div
                  key={card.id}
                  className={cn(
                    "absolute flex flex-col justify-center gap-0.5 rounded-md border bg-card px-3 py-1.5 text-card-foreground shadow-sm transition-opacity",
                    !on && "opacity-30",
                    picked && "border-foreground/40",
                  )}
                  style={{
                    left: card.x,
                    top: card.y,
                    width: CARD.w,
                    height: CARD.h,
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div className="text-muted-foreground flex h-5 items-center justify-between gap-2 text-[10px] tracking-wide uppercase">
                    <span>{t(`kinds.${card.kind}`)}</span>
                    {control(card)}
                  </div>
                  {card.kind === "toolset" ? (
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => setToolsetName(picked ? null : card.label)}
                      className={cn(
                        "truncate text-left text-sm font-semibold hover:underline",
                        picked && "underline",
                      )}
                    >
                      {card.label}
                    </button>
                  ) : (
                    <span className="truncate text-sm font-semibold">{card.label}</span>
                  )}
                  {detail(card)}
                </div>
              );
            })}
          </div>
          {loading && (
            <div className="bg-background/60 absolute inset-0 grid place-items-center">
              <Spinner />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
