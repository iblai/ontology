"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Plus, ShieldCheck } from "lucide-react";
import { Spinner } from "@iblai/iblai-js/web-containers";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { GraphData, GraphKind, McpToolset, Role } from "@/lib/ontology/types";
import {
  KIND_COLORS,
  cacheTables,
  cachesDomain,
  endId,
  grantPatch,
  reach,
  type ToggleKind,
} from "@/lib/ontology/graph";
import { held, roleScope, setTools } from "@/lib/ontology/access";
import { useRoleLabel } from "@/lib/ontology/use-role-label";
import { CARD, COLUMNS, colX, layoutFlow, type FlowCard } from "@/lib/ontology/flow";
import { SectionHeader } from "@/components/console/section-header";
import { EmptyState } from "@/components/console/empty-state";
import { RoleDialog } from "@/components/roles/role-dialog";
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
/** On a card's main control: a click anywhere on the node is a click on it. */
const STRETCH = "cursor-pointer after:absolute after:inset-0";
/** On a card's other control: it stays clickable above the stretched one. */
const RAISED = "relative z-10";
/** A switch over several tools of which the role holds some: its thumb rests in the middle. */
const SOME = "data-[state=unchecked]:bg-foreground/30 [&>span]:translate-x-[7px]!";
/** The methods an API's tools send, in the order their switches stand. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
/** What a switch is over, for its words: reading, changing data, or one method. */
type Verb = "read" | "write" | "method";

export default function AccessPage() {
  const t = useTranslations("access");
  const tg = useTranslations("graph");
  const tc = useTranslations("common");
  const roleLabel = useRoleLabel();
  const [data, setData] = useState<GraphData | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [toolsets, setToolsets] = useState<McpToolset[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleName, setRoleName] = useState("all");
  const [toolsetName, setToolsetName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  // Bumped to read everything again, after a role is created here.
  const [version, setVersion] = useState(0);

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
  }, [tg, version]);

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
  // The memory domains that are cached in a table: only those have a cache to grant.
  const cached = useMemo(
    () =>
      new Map(
        graph.nodes
          .filter((n) => n.kind === "memory_domain" && cacheTables(n).length > 0)
          .map((n) => [n.id, n]),
      ),
    [graph.nodes],
  );
  // The toolsets whose tools change data: their cards say so.
  const writes = useMemo(
    () => new Set(graph.nodes.filter((n) => n.kind === "toolset" && n.meta.write).map((n) => n.id)),
    [graph.nodes],
  );
  // The tools on the map: which can change data, what each sends, and whose each is.
  const tooling = useMemo(() => {
    const tools = graph.nodes.filter((n) => n.kind === "tool");
    const name = (id: string) => id.slice("tool:".length);
    const owned = (key: "service" | "source") => {
      const by = new Map<string, string[]>();
      for (const n of tools) {
        const owner = String(n.meta[key] ?? "");
        if (owner) by.set(owner, [...(by.get(owner) ?? []), name(n.id)]);
      }
      return by;
    };
    return {
      toolsets,
      writing: new Set(tools.filter((n) => n.meta.write).map((n) => name(n.id))),
      known: new Set(tools.map((n) => name(n.id))),
      method: new Map(tools.map((n) => [name(n.id), String(n.meta.method ?? "")])),
      byService: owned("service"),
      bySource: owned("source"),
    };
  }, [graph.nodes, toolsets]);
  // What the picked role may call. An older backend's roles hold no tool by name: it gets
  // the toolset switches alone, never one that would save nothing.
  const scope = useMemo(
    () => (role && role.mcp_tools !== undefined ? roleScope(role, tooling) : null),
    [role, tooling],
  );

  /** After a save: the map, the roles with how far each now reaches, and the toolsets, read again. */
  async function refresh() {
    try {
      const [g, r, ts] = await Promise.all([
        apiClient.graph.get(false),
        apiClient.roles.list(),
        apiClient.mcp.toolsets(),
      ]);
      if (g.ok === false) toast.error(g.message || tg("loadFailed"));
      else setData(g);
      setRoles(r);
      setToolsets(ts);
    } catch (e) {
      console.error("access reload failed", e);
      toast.error(tg("loadFailed"));
    }
  }

  /** Save a role as it now stands and say so; the switches wait until the page has read it back. */
  async function saveRole(next: Role, said: string) {
    setSaving(true);
    try {
      const r = await apiClient.roles.save(next);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(said);
      await refresh();
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  }

  function onGrant(kind: ToggleKind, name: string) {
    if (!role) return;
    const patch = grantPatch(graph, role, kind, name);
    const said = tg(patch.had ? "revoked" : "granted", { role: role.display_name, name });
    return saveRole(patch.role, said);
  }

  /** Switch some tools on or off for the picked role; `own` is the toolset whose card it is. */
  function onTools(tools: string[], on: boolean, said: string, own?: string) {
    if (!role) return;
    return saveRole(setTools(role, tools, on, tooling, own), said);
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
      toast.success(t(had ? "removed" : "added", { tool, toolset: next.name }));
      // What a toolset lends changes how far its roles reach.
      await refresh();
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
    // A node whose control is stretched over it is that control: it clicks, it does not pan.
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

  /** The tools under a card: its own, a toolset's, a source's or a system's. */
  function under(card: FlowCard): string[] {
    const name = card.id.slice(card.kind.length + 1);
    if (card.kind === "tool") return [name];
    if (card.kind === "toolset") return toolsets.find((ts) => ts.name === name)?.tools ?? [];
    if (card.kind === "source") return tooling.bySource.get(name) ?? [];
    return card.kind === "service" ? (tooling.byService.get(name) ?? []) : [];
  }

  /** What a switch over `tools` shows and does: on, off or some, its words, and its flip. */
  function over(card: FlowCard, tools: string[], verb: Verb, method = "") {
    const state = scope ? held(scope, tools) : "none";
    const on = state !== "all";
    const words = { role: role?.display_name ?? "", name: card.label, method };
    const label = t(`${verb}Of`, { name: card.label, method });
    return {
      state,
      label: state === "some" ? t("someOf", { what: label }) : label,
      flip: () =>
        onTools(
          tools,
          on,
          t(`${on ? "can" : "cannot"}.${verb}`, words),
          card.kind === "toolset" ? card.label : undefined,
        ),
    };
  }

  /** A system's methods in its card's top row: one switch per method its tools send. */
  function methods(card: FlowCard) {
    if (!scope || card.kind !== "service") return null;
    const tools = under(card);
    const sent = METHODS.map((m) => [m, tools.filter((x) => tooling.method.get(x) === m)] as const);
    if (sent.every(([, list]) => list.length === 0)) return null;
    return (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {sent.map(([method, list]) => {
          if (list.length === 0) return null;
          const { state, label, flip } = over(card, list, "method", method);
          return (
            <button
              key={method}
              type="button"
              aria-pressed={state === "all" ? true : state === "some" ? "mixed" : false}
              aria-label={label}
              title={state === "some" ? t("some") : undefined}
              disabled={saving}
              onClick={flip}
              className={cn(
                RAISED,
                "rounded border px-1 text-[9px] leading-4 font-medium disabled:opacity-50",
                state === "all" && "border-foreground bg-foreground text-background",
                state === "some" && "border-foreground/60 text-foreground border-dashed",
              )}
            >
              {method}
            </button>
          );
        })}
      </span>
    );
  }

  /** The switch in a card's top row: a role's toolset grant, or a tool's membership in the picked toolset. */
  function control(card: FlowCard) {
    // Where roles hold tools by name, Read and Write stand on the card's last row instead;
    // a toolset with no tool yet is still held whole, so what joins it later comes along.
    if (role && card.kind === "toolset" && (!scope || under(card).length === 0))
      return (
        <Switch
          className={STRETCH}
          aria-label={t("grant", { name: card.label })}
          checked={granted.has(`grants>${card.id}`)}
          disabled={saving}
          onCheckedChange={() => onGrant("toolset", card.label)}
        />
      );
    if (toolset && card.kind === "tool")
      return (
        <Switch
          className={STRETCH}
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
    if (role && card.kind === "memory_domain") {
      const domain = cached.get(card.id);
      return (
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          {t("read")}
          <Switch
            className={STRETCH}
            aria-label={t("readOf", { name: card.label })}
            checked={granted.has(`reads>${card.id}`)}
            disabled={saving}
            onCheckedChange={() => onGrant("memory_domain", card.label)}
          />
          {domain && (
            <>
              <span className="ml-1">{t("cache")}</span>
              <Switch
                className={RAISED}
                aria-label={t("cacheOf", { name: card.label })}
                checked={cachesDomain(role, domain)}
                disabled={saving}
                onCheckedChange={() => onGrant("cache", card.label)}
              />
            </>
          )}
        </span>
      );
    }
    // With a role picked: Read over the tools under the card that only read, Write over those
    // that change data. With a toolset picked a tool's card is about its place in that toolset.
    const tools = scope && !(toolset && card.kind === "tool") ? under(card) : [];
    const reads = tools.filter((x) => !tooling.writing.has(x));
    const changes = tools.filter((x) => tooling.writing.has(x));
    if (tools.length > 0) {
      // A click anywhere on the card flips its switch only where it has just one.
      const place = reads.length > 0 && changes.length > 0 ? RAISED : STRETCH;
      const one = (list: string[], verb: Verb) => {
        const { state, label, flip } = over(card, list, verb);
        return (
          <Switch
            className={cn(place, state === "some" && SOME)}
            aria-label={label}
            title={state === "some" ? t("some") : undefined}
            checked={state === "all"}
            disabled={saving}
            onCheckedChange={flip}
          />
        );
      };
      return (
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          {reads.length > 0 && (
            <>
              {t("read")}
              {one(reads, "read")}
            </>
          )}
          {changes.length > 0 && (
            <>
              <span className={cn(reads.length > 0 && "ml-1")}>{t("write")}</span>
              {one(changes, "write")}
            </>
          )}
        </span>
      );
    }
    const fact =
      card.fact ?? (card.count ? t(`count.${card.count.unit}`, { n: card.count.n }) : "");
    // A role's card says how far it reaches, where the backend says so.
    const level =
      card.kind === "role" ? roles.find((r) => `role:${r.name}` === card.id)?.access : undefined;
    const text = writes.has(card.id)
      ? `${fact} · ${tc("changesData")}`
      : level
        ? `${t(`levelName.${level}`)} · ${fact}`
        : fact;
    return <span className="text-muted-foreground truncate text-[11px]">{text}</span>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-muted-foreground text-xs">{t("role")}</Label>
          <Select value={roleName} onValueChange={setRoleName}>
            <SelectTrigger className="h-9 w-72" aria-label={t("role")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allRoles")}</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {roleLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setCreating(true)}>
          <Plus className="mr-2 size-3.5" />
          {t("newRole")}
        </Button>
        <p className="text-muted-foreground pb-2 text-xs">
          {toolset
            ? t("hintToolset", { name: toolset.name })
            : role
              ? t(scope ? "hintRole" : "hintRoleToolsets", { role: role.display_name })
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
              const color = KIND_COLORS[card.kind === "agent" ? "role" : card.kind];
              const sends = methods(card);
              const cardRole = card.kind === "role" ? card.id.slice("role:".length) : null;
              const picked =
                cardRole !== null
                  ? roleName === cardRole
                  : card.kind === "toolset" && toolsetName === card.label;
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
                    {sends ?? <span>{t(`kinds.${card.kind}`)}</span>}
                    {control(card)}
                  </div>
                  {cardRole !== null || card.kind === "toolset" ? (
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() =>
                        cardRole !== null
                          ? setRoleName(picked ? "all" : cardRole)
                          : setToolsetName(picked ? null : card.label)
                      }
                      className={cn(
                        "truncate text-left text-sm font-semibold hover:underline",
                        picked && "underline",
                        // With a role picked a toolset's switch is its node's click; its name still opens its tools.
                        card.kind === "toolset" && role ? RAISED : STRETCH,
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
      <RoleDialog
        key={creating ? "new" : "closed"}
        open={creating}
        onOpenChange={setCreating}
        taken={roles.map((r) => r.name)}
        onSaved={(saved) => {
          // Listed and picked at once; its node arrives with the map, read again.
          setRoles((rs) => [...rs.filter((x) => x.name !== saved.name), saved]);
          setRoleName(saved.name);
          setVersion((v) => v + 1);
        }}
      />
    </div>
  );
}
