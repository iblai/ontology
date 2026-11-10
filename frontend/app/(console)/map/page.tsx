"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { List, Maximize2, Search, Waypoints } from "lucide-react";
import { Spinner } from "@iblai/iblai-js/web-containers";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { GraphData, GraphKind, GraphLink, GraphNode, Role } from "@/lib/ontology/types";
import {
  KINDS,
  KIND_COLORS,
  grantPatch,
  reach,
  searchGraph,
  SURFACE,
  type ToggleKind,
} from "@/lib/ontology/graph";
import { EmptyState } from "@/components/console/empty-state";
import { NodePanel } from "@/components/graph/node-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const GraphCanvas = dynamic(() => import("@/components/graph/graph-canvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center">
      <Spinner />
    </div>
  ),
});

const EMPTY: GraphData = { nodes: [], links: [], stats: { hubs: [], orphans: 0, dangling: 0 } };
const HIDDEN_DEFAULT: GraphKind[] = ["column", "memory_record"];
/** The floating panels over the canvas. */
const GLASS = "rounded-xl border border-white/10 bg-[#0f1526]/75 shadow-xl backdrop-blur-md";
/** A faint dot grid and a soft glow behind the graph; the canvas itself is transparent. */
const SKY = {
  backgroundColor: SURFACE,
  backgroundImage:
    "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.3px), radial-gradient(ellipse 70% 55% at 50% 40%, rgba(57,135,229,0.14), transparent 65%)",
  backgroundSize: "24px 24px, 100% 100%",
};

export default function GraphPage() {
  const t = useTranslations("graph");
  const tc = useTranslations("common");
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [columns, setColumns] = useState(false);
  const [hidden, setHidden] = useState<Set<GraphKind>>(new Set(HIDDEN_DEFAULT));
  const [issues, setIssues] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRole, setFocusRole] = useState("all");
  const [roles, setRoles] = useState<Role[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);
  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([apiClient.graph.get(columns), apiClient.roles.list()])
      .then(([g, r]) => {
        if (!live) return;
        if (g.ok === false) toast.error(g.message || t("loadFailed"));
        setData(g);
        setRoles(r);
        setExpanded(new Set());
      })
      .catch((e) => {
        console.error("graph load failed", e);
        if (live) toast.error(t("loadFailed"));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [columns, t]);

  const graph = data ?? EMPTY;
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const selected = selectedId ? (nodesById.get(selectedId) ?? null) : null;
  const focus = useMemo(
    () => (focusRole === "all" ? null : reach(graph.links, `role:${focusRole}`)),
    [graph.links, focusRole],
  );
  const matches = useMemo(() => searchGraph(graph.nodes, query), [graph.nodes, query]);
  const counts = useMemo(() => {
    const c = new Map<GraphKind, number>();
    for (const n of graph.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [graph.nodes]);

  function toggleKind(kind: GraphKind) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  async function onToggle(role: Role, kind: ToggleKind, name: string) {
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
      toast.success(t(patch.had ? "revoked" : "granted", { role: role.display_name, name }));
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  }

  async function onExpand(domain: string) {
    setSaving(true);
    try {
      const r = await apiClient.graph.records(domain);
      if (r.ok === false) {
        toast.error(r.message || t("loadFailed"));
        return;
      }
      setData((d) => {
        if (!d) return d;
        const known = new Set(d.nodes.map((n) => n.id));
        const fresh = r.nodes.filter((n) => !known.has(n.id));
        const hub = `memory_domain:${domain}`;
        const nodes: GraphNode[] = [...d.nodes, ...fresh];
        const links: GraphLink[] = [
          ...d.links,
          ...fresh
            .filter((n) => n.group === domain)
            .map((n) => ({ source: hub, target: n.id, kind: "has_record" as const })),
          ...r.links,
        ];
        return { ...d, nodes, links };
      });
      setExpanded((s) => new Set(s).add(domain));
      setHidden((h) => {
        const next = new Set(h);
        next.delete("memory_record");
        return next;
      });
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  }

  function onCollapse(domain: string) {
    setData((d) => {
      if (!d) return d;
      const gone = new Set(
        d.nodes.filter((n) => n.kind === "memory_record" && n.group === domain).map((n) => n.id),
      );
      let links = d.links.filter((l) => !gone.has(String(l.source)) && !gone.has(String(l.target)));
      const linked = new Set(links.flatMap((l) => [String(l.source), String(l.target)]));
      const nodes = d.nodes.filter(
        (n) => !gone.has(n.id) && (n.kind !== "memory_record" || linked.has(n.id)),
      );
      const kept = new Set(nodes.map((n) => n.id));
      links = links.filter((l) => kept.has(String(l.source)) && kept.has(String(l.target)));
      return { ...d, nodes, links };
    });
    setExpanded((s) => {
      const next = new Set(s);
      next.delete(domain);
      return next;
    });
    if (selected?.kind === "memory_record" && selected.group === domain) setSelectedId(null);
  }

  const focusColor = focusRole === "all" ? null : KIND_COLORS.role;
  const empty = !!data && data.nodes.length === 0 && !loading;

  return (
    <div className="relative h-full w-full overflow-hidden" style={SKY}>
      {empty ? (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className={cn(GLASS, "w-full max-w-md p-2")}>
            <EmptyState
              icon={Waypoints}
              title={t("emptyTitle")}
              hint={t("emptyHint")}
              action={
                <Button asChild variant="outline" size="sm">
                  <Link href="/services/add">{t("emptyAction")}</Link>
                </Button>
              }
            />
          </div>
        </div>
      ) : (
        <GraphCanvas
          data={graph}
          hiddenKinds={hidden}
          emphasis={focus?.nodes ?? null}
          granted={focus?.granted ?? new Set()}
          focusColor={focusColor}
          issues={issues}
          selectedId={selectedId}
          reduced={reduced}
          fitSignal={fitSignal}
          onSelect={setSelectedId}
        />
      )}

      <div className="pointer-events-none absolute inset-x-6 top-6 z-10 flex flex-wrap items-start justify-between gap-3">
        <div
          className={cn(
            GLASS,
            "pointer-events-auto px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-500",
          )}
        >
          <h1 className="text-base font-semibold tracking-tight text-white">{t("title")}</h1>
          <p className="mt-0.5 text-[11px] text-white/55">
            {data ? (
              <>
                {t("statNodes", { n: graph.nodes.length })} ·{" "}
                {t("statLinks", { n: graph.links.length })} ·{" "}
                {t("statOrphans", { n: graph.stats.orphans })} ·{" "}
                <span className={cn(graph.stats.dangling > 0 && "text-[#e66767]")}>
                  {t("statDangling", { n: graph.stats.dangling })}
                </span>
              </>
            ) : (
              t("subtitle")
            )}
          </p>
        </div>
        <div
          className={cn(
            GLASS,
            "pointer-events-auto flex flex-wrap items-center gap-1.5 p-1.5 animate-in fade-in slide-in-from-top-2 duration-500",
          )}
        >
          <Select value={focusRole} onValueChange={setFocusRole}>
            <SelectTrigger
              className="h-8 w-44 border-white/10 bg-white/5 text-xs text-white"
              aria-label={t("focusRole")}
            >
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
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-white/40" />
            <Input
              aria-label={t("search")}
              placeholder={t("search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  setSelectedId(matches[0].id);
                  setQuery("");
                }
              }}
              className="h-8 w-56 border-white/10 bg-white/5 pl-8 text-xs text-white placeholder:text-white/40"
            />
            {query.trim() && (
              <div className={cn(GLASS, "absolute top-9 left-0 z-20 flex w-72 flex-col p-1")}>
                {matches.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs text-white/85 hover:bg-white/10"
                    onClick={() => {
                      setSelectedId(m.id);
                      setQuery("");
                    }}
                  >
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: KIND_COLORS[m.kind] }}
                    />
                    <span className="truncate">{m.label}</span>
                    <span className="ml-auto text-white/40">{t(`kinds.${m.kind}`)}</span>
                  </button>
                ))}
                <span className="px-2 py-1 text-xs text-white/40">
                  {t("matches", { n: matches.length })}
                </span>
              </div>
            )}
          </div>
          <label className="flex h-8 items-center gap-2 px-2 text-xs text-white/70">
            <Switch checked={columns} onCheckedChange={(v) => setColumns(v === true)} />
            {t("columns")}
          </label>
          <label className="flex h-8 items-center gap-2 px-2 text-xs text-white/70">
            <Switch checked={issues} onCheckedChange={(v) => setIssues(v === true)} />
            {t("issues")}
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label={t("fit")}
            onClick={() => setFitSignal((n) => n + 1)}
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {counts.size > 0 && (
        <button
          type="button"
          aria-expanded={legendOpen}
          onClick={() => setLegendOpen((v) => !v)}
          className={cn(
            GLASS,
            "absolute bottom-6 left-6 z-10 flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white/70 hover:text-white",
          )}
        >
          <List className="size-3.5" />
          {t("legend")}
        </button>
      )}
      {legendOpen && counts.size > 0 && (
        <div
          className={cn(
            GLASS,
            "absolute bottom-16 left-6 z-10 px-3 py-2 animate-in fade-in slide-in-from-bottom-2 duration-300",
          )}
        >
          <ul aria-label={t("legend")} className="grid grid-cols-2 gap-x-5 gap-y-0.5">
            {KINDS.filter((k) => counts.get(k)).map((k) => (
              <li key={k}>
                <button
                  type="button"
                  aria-pressed={!hidden.has(k)}
                  aria-label={t("toggleKind", { label: t(`kinds.${k}`), n: counts.get(k) ?? 0 })}
                  onClick={() => toggleKind(k)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] text-white/80 hover:bg-white/10",
                    hidden.has(k) && "text-white/35 line-through",
                  )}
                >
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: KIND_COLORS[k] }}
                  />
                  <span className="truncate">{t(`kinds.${k}`)}</span>
                  <span className="ml-auto pl-3 text-white/40 tabular-nums">{counts.get(k)}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[10px] text-white/35">
            {t("hint")}
          </p>
        </div>
      )}

      {selected && (
        <div className="animate-in fade-in slide-in-from-right-2 absolute top-22 right-6 bottom-6 z-10 w-80 duration-300">
          <NodePanel
            key={selected.id}
            node={selected}
            data={graph}
            roles={roles}
            expanded={expanded}
            saving={saving}
            onSelect={setSelectedId}
            onToggle={onToggle}
            onExpand={onExpand}
            onCollapse={onCollapse}
          />
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-[#0f1526]/40">
          <Spinner />
        </div>
      )}
    </div>
  );
}
