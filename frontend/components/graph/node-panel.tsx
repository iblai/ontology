"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { GraphData, GraphKind, GraphLinkKind, GraphNode, Role } from "@/lib/ontology/types";
import {
  KIND_COLORS,
  cacheTables,
  cachesDomain,
  endId,
  type ToggleKind,
} from "@/lib/ontology/graph";
import { fmtRows } from "@/lib/ontology/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface PanelProps {
  node: GraphNode;
  data: GraphData;
  roles: Role[];
  expanded: Set<string>;
  saving: boolean;
  onSelect: (id: string | null) => void;
  onToggle: (role: Role, kind: ToggleKind, name: string) => void;
  onExpand: (domain: string) => void;
  onCollapse: (domain: string) => void;
}

const LINK_LABEL: Record<GraphLinkKind, string> = {
  has_table: "tables",
  has_column: "columns",
  in_group: "entityGroup",
  references: "references",
  exposes: "exposes",
  uses_source: "source",
  contains: "tools",
  grants: "toolsets",
  reads: "memoryDomains",
  caches: "cacheTables",
  syncs_from: "syncsFrom",
  runs: "runs",
  writes: "writes",
  queries: "queries",
  has_record: "records",
  links: "linked",
};
const OPEN: Partial<Record<GraphKind, string>> = {
  service: "/services",
  tool: "/mcp",
  toolset: "/mcp",
  source: "/mcp",
  role: "/roles",
  schedule: "/sync",
  table: "/catalog",
};
const TOGGLES = [
  ["toolset", "toolset", "grants"],
  ["memory_domain", "memory_domain", "reads"],
  ["cache", "memory_domain", "caches"],
] as const;

/** Facts, connections and the role toggles for the selected node. */
export function NodePanel({
  node,
  data,
  roles,
  expanded,
  saving,
  onSelect,
  onToggle,
  onExpand,
  onCollapse,
}: PanelProps) {
  const t = useTranslations("graph");
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  // Connections grouped by relation: outgoing under the relation, incoming under its "By" reading.
  const groups = new Map<string, GraphNode[]>();
  for (const l of data.links) {
    const s = endId(l.source);
    const tgt = endId(l.target);
    const key =
      s === node.id ? LINK_LABEL[l.kind] : tgt === node.id ? `${LINK_LABEL[l.kind]}By` : null;
    const other = s === node.id ? byId.get(tgt) : byId.get(s);
    if (key && other) groups.set(key, [...(groups.get(key) ?? []), other]);
  }
  const meta = node.meta as Record<string, unknown>;
  const facts: [string, string][] = [];
  const fact = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "" && !Array.isArray(value))
      facts.push([key, String(value)]);
  };
  fact("kind", t(`kinds.${node.kind}`));
  if (node.group && node.kind !== "entity_group") fact("group", node.group);
  fact("adapter", meta.adapter);
  fact("status", meta.status);
  if (typeof meta.row_count === "number") fact("rows", fmtRows(meta.row_count));
  fact("columnsCount", meta.column_count);
  fact("entity", meta.entity);
  fact("type", meta.type);
  fact("host", meta.host);
  fact("cron", meta.cron);
  if (typeof meta.enabled === "boolean") fact("enabled", meta.enabled ? t("yes") : t("no"));
  fact("files", meta.files);
  fact("expected", meta.expected);
  const role =
    node.kind === "role" ? roles.find((r) => r.name === node.id.slice("role:".length)) : undefined;
  const allOf = (kind: GraphKind) =>
    data.nodes
      .filter((n) => n.kind === kind)
      .map((n) => n.id.slice(kind.length + 1))
      .sort();
  const grantedTo = (kind: GraphLinkKind) =>
    new Set(
      data.links
        .filter((l) => l.kind === kind && endId(l.source) === node.id)
        .map((l) => endId(l.target)),
    );
  const open = OPEN[node.kind];
  const fields =
    node.kind === "memory_record" && meta.fields && typeof meta.fields === "object"
      ? Object.entries(meta.fields as Record<string, string>).slice(0, 8)
      : [];

  return (
    <aside className="flex h-full w-full flex-col gap-4 overflow-y-auto rounded-xl border border-white/10 bg-[#0f1526]/80 p-4 shadow-xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-foreground flex items-center gap-2 text-sm font-medium break-all">
          <span
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: KIND_COLORS[node.kind] }}
          />
          {node.label}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-7 w-7 p-0"
          aria-label={t("close")}
          onClick={() => onSelect(null)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <dl className="flex flex-col gap-1 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t(`facts.${k}`)}</dt>
            <dd className="text-foreground truncate">{v}</dd>
          </div>
        ))}
      </dl>
      {typeof meta.description === "string" && meta.description && (
        <p className="text-muted-foreground text-xs">{meta.description}</p>
      )}
      {typeof meta.statement === "string" && meta.statement && (
        <pre className="bg-muted/40 max-h-32 overflow-auto rounded-md border p-2 font-mono text-[11px] whitespace-pre-wrap">
          {meta.statement}
        </pre>
      )}
      {fields.length > 0 && (
        <dl className="flex flex-col gap-1 text-xs">
          {fields.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground truncate">{k}</dt>
              <dd className="text-foreground truncate">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {node.kind === "memory_domain" && (
        <Button
          size="sm"
          variant="outline"
          disabled={saving}
          onClick={() => (expanded.has(node.group) ? onCollapse(node.group) : onExpand(node.group))}
        >
          {expanded.has(node.group) ? t("collapse") : t("expand", { n: Number(meta.files ?? 0) })}
        </Button>
      )}
      {role && (
        <div className="flex flex-col gap-3 border-t pt-4">
          {TOGGLES.map(([toggleKind, nodeKind, linkKind]) => {
            // A cache toggle stands for its domain's tables: only a domain that has one,
            // and granted when the role holds one of them.
            const domain = (name: string) =>
              toggleKind === "cache" ? byId.get(`memory_domain:${name}`) : undefined;
            const names = allOf(nodeKind).filter((name) => {
              const node = domain(name);
              return !node || cacheTables(node).length > 0;
            });
            const have = grantedTo(linkKind);
            const checked = (name: string) => {
              const node = domain(name);
              return node ? cachesDomain(role, node) : have.has(`${nodeKind}:${name}`);
            };
            if (names.length === 0) return null;
            return (
              <div key={toggleKind} className="flex flex-col gap-1">
                <p className="text-foreground text-xs font-medium">{t(`toggles.${toggleKind}`)}</p>
                <ul className="flex flex-col">
                  {names.map((name) => (
                    <li key={name}>
                      <label className="hover:bg-muted flex items-center gap-2 rounded px-1 py-0.5 text-xs">
                        <Checkbox
                          checked={checked(name)}
                          disabled={saving}
                          onCheckedChange={() => onToggle(role, toggleKind, name)}
                        />
                        <span className="truncate">{name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {role.mcp_toolsets.includes("*") && (
            <p className="text-muted-foreground text-xs">{t("wildcardNote")}</p>
          )}
        </div>
      )}
      {[...groups].map(([key, nodes]) => (
        <div key={key} className="flex flex-col gap-1">
          <p className="text-foreground text-xs font-medium">
            {t(`links.${key}`)}{" "}
            <span className="text-muted-foreground font-normal">· {nodes.length}</span>
          </p>
          <ul className="max-h-40 overflow-y-auto rounded-md border p-1">
            {nodes.slice(0, 60).map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="hover:bg-muted flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs"
                  onClick={() => onSelect(n.id)}
                >
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: KIND_COLORS[n.kind] }}
                  />
                  <span className="truncate">{n.label}</span>
                  {n.health && (
                    <span className="text-muted-foreground ml-auto">{t(`health.${n.health}`)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {open && (
        <Button asChild variant="outline" size="sm">
          <Link href={open}>{t("open")}</Link>
        </Button>
      )}
    </aside>
  );
}
