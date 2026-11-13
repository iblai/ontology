"use client";

import { type FormEventHandler, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { GraphNode, McpToolset, Role } from "@/lib/ontology/types";
import {
  cacheTables,
  cachesDomain,
  readsDomain,
  technicalName,
  toggleGrant,
} from "@/lib/ontology/graph";
import { saveLatest } from "@/lib/ontology/save-latest";
import { Field } from "@/components/console/form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

/** A new role: nothing granted, and a row limit. */
const BLANK: Role = {
  name: "",
  display_name: "",
  mcp_toolsets: [],
  mcp_tools: [],
  memory_paths: [],
  cache_tables: [],
  admin_dashboard: false,
  agents: [],
  concurrency_limits: { max_records_per_query: 1000 },
};
const ROW_LIMITS = ["100", "1000", "10000"];
/** One line of the dialog: what it is on the left, its control on the right. */
const ROW = "flex min-h-8 items-center justify-between gap-3 text-sm";
const NAME = "flex min-w-0 items-baseline gap-2";
const NOTE = "text-muted-foreground shrink-0 text-xs";
/** A switch column of the Knowledge rows, under its heading. */
const COLUMN = "flex w-20 justify-end";
/** A section's heading line, one height in both columns so their rows share lines. */
const HEADING = "flex h-5 items-baseline gap-2";
/** The small text on a heading line: no leading, so the heading itself stays at the line's top. */
const ASIDE = "text-muted-foreground text-xs leading-none";

/** A new role is a draft until Create; a role that exists is saved with every change. */
export function RoleDialog({
  open,
  onOpenChange,
  initial,
  taken,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Role;
  /** The technical names in use: a new role never takes one of them. */
  taken: string[];
  /** Called with the role as it was saved. */
  onSaved: (role: Role) => void;
}) {
  const t = useTranslations("roles");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [role, setRole] = useState<Role>(initial ?? BLANK);
  const [nameText, setNameText] = useState(initial?.display_name ?? "");
  // What the switches stand for, read when the dialog opens.
  const [lists, setLists] = useState<{ toolsets: McpToolset[]; domains: GraphNode[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [unnamed, setUnnamed] = useState(false);
  const [creating, setCreating] = useState(false);
  // The newest role, ahead of the next render: two changes in one instant build on each other.
  const latest = useRef(role);
  // The role as the backend holds it: what a refused save goes back to.
  const stored = useRef(initial);
  // One saver for the dialog's life, made at the first change: it sends the saves one at a time.
  const saver = useRef<((next: Role) => Promise<void>) | null>(null);
  function save(next: Role) {
    saver.current ??= saveLatest(
      (sent: Role) =>
        apiClient.roles.save(sent).catch(() => ({ ok: false, message: tc("failed") })),
      (sent, result) => {
        if (result.ok) {
          stored.current = sent;
          onSaved(sent);
          return;
        }
        toast.error(result.message);
        if (!stored.current) return;
        latest.current = stored.current;
        setRole(stored.current);
        setNameText(stored.current.display_name);
      },
    );
    return saver.current(next);
  }

  useEffect(() => {
    if (!open) return;
    let live = true;
    Promise.all([apiClient.graph.get(false), apiClient.mcp.toolsets()])
      .then(([g, toolsets]) => {
        if (g.ok === false) throw new Error(g.message);
        const domains = g.nodes
          .filter((n) => n.kind === "memory_domain")
          .sort((a, b) => a.label.localeCompare(b.label));
        if (live) setLists({ toolsets, domains });
      })
      .catch((e) => {
        console.error("role dialog load failed", e);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [open]);

  const name = initial ? initial.name : nameText.trim() && technicalName(nameText, taken);
  const all = role.mcp_toolsets.includes("*");
  const known = lists?.toolsets ?? [];
  const readOnly = known.filter((ts) => !ts.write).map((ts) => ts.name);
  const toolsets = [
    ...known.map((ts) => ({
      name: ts.name,
      note: t("toolCount", { n: ts.tools.length }) + (ts.write ? ` · ${tc("changesData")}` : ""),
      on: (all && !ts.write) || role.mcp_toolsets.includes(ts.name),
    })),
    // A toolset the role names that is gone: listed, so it can be switched off.
    ...role.mcp_toolsets
      .filter((n) => n !== "*" && !known.some((ts) => ts.name === n))
      .map((n) => ({ name: n, note: t("missing"), on: true })),
  ];
  const domains = lists?.domains ?? [];
  const labels = domains.map((d) => d.label);
  const tables = [...new Set(domains.flatMap(cacheTables))];
  const limit = role.concurrency_limits?.max_records_per_query;
  const rows = limit == null ? "none" : String(limit);
  // A stored limit outside the list is its own option.
  const rowOptions = [...new Set([...ROW_LIMITS, ...(rows === "none" ? [] : [rows])])].sort(
    (a, b) => Number(a) - Number(b),
  );
  // One column when there is no Knowledge to set beside the rest.
  const narrow = failed || (lists !== null && domains.length === 0);

  /** A change shows at once; on a role that exists it is saved at once too. */
  function change(update: (role: Role) => Role) {
    const next = update(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    setRole(next);
    if (initial) void save(next);
  }

  function setRows(value: string) {
    change((r) => {
      // The limits go whole: the backend replaces them as one, so "No limit" is the key left out.
      const limits = { ...r.concurrency_limits };
      if (value === "none") delete limits.max_records_per_query;
      else limits.max_records_per_query = Number(value);
      return { ...r, concurrency_limits: limits };
    });
  }

  /** The typed name becomes the role's; false when there is none to take. */
  function commitName(): boolean {
    const display_name = nameText.trim();
    if (!display_name) {
      setUnnamed(true);
      return false;
    }
    change((r) => (r.display_name === display_name ? r : { ...r, display_name }));
    return true;
  }

  async function create() {
    const display_name = nameText.trim();
    if (!display_name) {
      setUnnamed(true);
      return;
    }
    const next: Role = { ...latest.current, name, display_name };
    setCreating(true);
    try {
      const r = await apiClient.roles.save(next);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(r.message);
      onSaved(next);
      onOpenChange(false);
    } catch {
      toast.error(tc("failed"));
    } finally {
      setCreating(false);
    }
  }

  const submit: FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    if (!initial) void create();
    else if (commitName()) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[85vh] overflow-y-auto", !narrow && "md:max-w-4xl")}>
        <DialogHeader>
          <DialogTitle>{initial ? t("editTitle") : t("newTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className={cn("grid gap-y-4", !narrow && "md:grid-cols-2")}>
            <div className={cn("flex min-w-0 flex-col gap-4", !narrow && "md:pr-6")}>
              {/* Three rows tall with its gap, hint or no hint: both columns' rows share lines. */}
              <div className="min-h-20">
                <Field
                  label={t("name")}
                  htmlFor="role-name"
                  error={unnamed ? tc("required") : undefined}
                  hint={name ? t("technicalName", { name }) : undefined}
                >
                  <Input
                    id="role-name"
                    value={nameText}
                    onChange={(e) => {
                      setUnnamed(false);
                      setNameText(e.target.value);
                    }}
                    onBlur={initial ? commitName : undefined}
                  />
                </Field>
              </div>
              {failed ? (
                <p role="alert" className="text-xs text-red-600">
                  {t("loadFailed")}
                </p>
              ) : !lists ? (
                <p className="text-muted-foreground text-xs">{tc("loading")}</p>
              ) : (
                <>
                  <section aria-labelledby="role-tools" className="flex flex-col gap-1.5">
                    <div className={HEADING}>
                      <h3 id="role-tools" className="text-sm leading-none font-medium">
                        {t("tools")}
                      </h3>
                      <span className={cn(ASIDE, "min-w-0")}>{t("toolsHint")}</span>
                    </div>
                    <div className="flex flex-col">
                      <label htmlFor="role-all-toolsets" className={ROW}>
                        <span className={NAME}>
                          <span className="truncate">{t("allToolsets")}</span>
                          <span className={NOTE}>{t("allToolsetsHint")}</span>
                        </span>
                        <Switch
                          id="role-all-toolsets"
                          aria-label={t("allToolsets")}
                          checked={all}
                          onCheckedChange={() =>
                            change((r) => ({
                              ...r,
                              // Off leaves the names held beside `*`; on keeps only those `*` does not cover.
                              mcp_toolsets: r.mcp_toolsets.includes("*")
                                ? r.mcp_toolsets.filter((n) => n !== "*")
                                : ["*", ...r.mcp_toolsets.filter((n) => !readOnly.includes(n))],
                            }))
                          }
                        />
                      </label>
                      {toolsets.map((ts) => (
                        <label key={ts.name} htmlFor={`role-toolset-${ts.name}`} className={ROW}>
                          <span className={NAME}>
                            <span className="truncate">{ts.name}</span>
                            <span className={NOTE}>{ts.note}</span>
                          </span>
                          <Switch
                            id={`role-toolset-${ts.name}`}
                            aria-label={ts.name}
                            checked={ts.on}
                            onCheckedChange={() =>
                              change((r) => toggleGrant(r, "toolset", ts.name, readOnly))
                            }
                          />
                        </label>
                      ))}
                    </div>
                    {/* Held one by one on Access, and left as they are here. */}
                    {(role.mcp_tools?.length ?? 0) > 0 && (
                      <p className="text-muted-foreground text-xs">
                        {t("namedTools", { n: role.mcp_tools?.length ?? 0 })}
                      </p>
                    )}
                  </section>
                  <div className={ROW}>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="role-rows">{t("maxRecords")}</Label>
                      <p className="text-muted-foreground text-xs">{t("maxRecordsHint")}</p>
                    </div>
                    <Select value={rows} onValueChange={setRows}>
                      <SelectTrigger id="role-rows" className="w-32 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {rowOptions.map((n) => (
                          <SelectItem key={n} value={n}>
                            {format.number(Number(n))}
                          </SelectItem>
                        ))}
                        <SelectItem value="none">{t("noLimit")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <label className={cn(ROW, "font-medium")}>
                    {t("adminDashboard")}
                    <Switch
                      checked={role.admin_dashboard}
                      onCheckedChange={(on) => change((r) => ({ ...r, admin_dashboard: on }))}
                    />
                  </label>
                </>
              )}
            </div>
            {domains.length > 0 && (
              <section
                aria-labelledby="role-knowledge"
                className="flex min-w-0 flex-col gap-1.5 md:border-l md:pl-6"
              >
                <div className={cn(HEADING, "justify-between")}>
                  <h3 id="role-knowledge" className="text-sm leading-none font-medium">
                    {t("knowledge")}
                  </h3>
                  <span className={cn(ASIDE, "flex shrink-0 gap-3")}>
                    <span className={COLUMN}>{t("read")}</span>
                    <span className={COLUMN}>{t("query")}</span>
                  </span>
                </div>
                <div className="flex flex-col">
                  {domains.map((domain) => {
                    const reads = readsDomain(role, domain.label);
                    return (
                      <div key={domain.id} className={ROW}>
                        <span className={NAME}>
                          <span className="truncate">{domain.label}</span>
                          {reads === "part" && <span className={NOTE}>{t("partial")}</span>}
                        </span>
                        <span className="flex shrink-0 gap-3">
                          <span className={COLUMN}>
                            <Switch
                              aria-label={t("readOf", { name: domain.label })}
                              checked={reads === "all"}
                              // Off and on again would grant the whole domain: its paths stay as they are.
                              disabled={reads === "part"}
                              onCheckedChange={() =>
                                change((r) => toggleGrant(r, "memory_domain", domain.label, labels))
                              }
                            />
                          </span>
                          <span className={COLUMN}>
                            {cacheTables(domain).length > 0 && (
                              <Switch
                                aria-label={t("queryOf", { name: domain.label })}
                                checked={cachesDomain(role, domain)}
                                onCheckedChange={() =>
                                  change((r) =>
                                    toggleGrant(r, "cache", cacheTables(domain), tables),
                                  )
                                }
                              />
                            )}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!initial && (creating || !lists)}>
              {initial ? tc("done") : tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
