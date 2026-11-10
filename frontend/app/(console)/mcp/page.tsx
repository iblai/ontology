"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck, Hammer, Plus, Pencil, Database } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type {
  GatewayHealth,
  McpSource,
  McpTool,
  McpToolset,
  ComplianceReport,
} from "@/lib/ontology/types";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { SectionHeader } from "@/components/console/section-header";
import { EmptyState } from "@/components/console/empty-state";
import { ConfirmDelete } from "@/components/console/confirm-delete";
import { FactRow, Facts } from "@/components/console/facts";
import { StatusPill } from "@/components/console/status-pill";
import { Issues } from "@/components/mcp/issues";
import { ToolDialog } from "@/components/mcp/tool-dialog";
import { ToolsetDialog } from "@/components/mcp/toolset-dialog";
import { SourceDialog } from "@/components/mcp/source-dialog";
import { ToolsYaml } from "@/components/mcp/tools-yaml";
import { useCreateParam } from "@/components/shell/use-create-param";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function McpPage() {
  const t = useTranslations("mcp");
  const tc = useTranslations("common");
  const [gateway, setGateway] = useState<GatewayHealth | null>(null);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [toolsets, setToolsets] = useState<McpToolset[] | null>(null);
  const [sources, setSources] = useState<McpSource[] | null>(null);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [editingTool, setEditingTool] = useState<McpTool | "new" | null>(null);
  const [editingToolset, setEditingToolset] = useState<McpToolset | "new" | null>(null);
  const [editingSource, setEditingSource] = useState<McpSource | "new" | null>(null);
  const [tab, setTab] = useState("gateway");
  useCreateParam("tool", () => {
    setTab("tools");
    setEditingTool("new");
  });
  useCreateParam("toolset", () => {
    setTab("toolsets");
    setEditingToolset("new");
  });
  useCreateParam("source", () => {
    setTab("sources");
    setEditingSource("new");
  });

  const reload = useCallback(() => {
    const err = (e: unknown) => console.error("mcp load failed", e);
    apiClient.mcp.tools().then(setTools).catch(err);
    apiClient.mcp.toolsets().then(setToolsets).catch(err);
    apiClient.mcp.sources().then(setSources).catch(err);
    apiClient.mcp.validate().then(setReport).catch(err);
  }, []);

  useEffect(() => {
    apiClient.mcp
      .status()
      .then(setGateway)
      .catch((e) => console.error("mcp load failed", e));
    reload();
  }, [reload]);

  async function validate() {
    const r = await apiClient.mcp.validate();
    setReport(r);
    toast.success(t("validate.title"));
  }

  async function build() {
    const r = await apiClient.mcp.build();
    toast.success(t("validate.buildToast", { n: r.nativeTools }));
  }

  async function act(call: Promise<{ ok: boolean; message: string }>) {
    const r = await call;
    if (r.ok) {
      toast.success(r.message);
      reload();
    } else {
      toast.error(r.message);
    }
  }

  const toolTypes = Array.from(new Set((tools ?? []).map((t) => t.type)));
  const filteredTools =
    typeFilter === "all" ? (tools ?? []) : (tools ?? []).filter((t) => t.type === typeFilter);
  const sourceNames = (sources ?? []).map((s) => s.name);
  const toolNames = (tools ?? []).map((x) => x.name);

  const toolCols: ColumnDef<McpTool, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("tools.colName")),
      cell: ({ row }) => (
        <span className="text-foreground text-xs font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "type",
      header: sortableHeader(t("tools.colType")),
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.type}</span>,
    },
    {
      accessorKey: "source",
      header: sortableHeader(t("tools.colSource")),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">{row.original.source}</span>
      ),
    },
    {
      accessorKey: "description",
      header: t("tools.colDescription"),
      cell: ({ row }) => (
        <span className="text-foreground text-xs">{row.original.description.slice(0, 60)}</span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <ConfirmDelete
          name={row.original.name}
          onConfirm={() => act(apiClient.mcp.removeTool(row.original.name))}
        />
      ),
    },
  ];

  const sourceCols: ColumnDef<McpSource, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("sources.colName")),
      cell: ({ row }) => (
        <span className="text-foreground text-xs font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "type",
      header: sortableHeader(t("sources.colType")),
      cell: ({ row }) => <span className="text-muted-foreground text-xs">{row.original.type}</span>,
    },
    {
      accessorKey: "host",
      header: t("sources.colHost"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">{row.original.host ?? "—"}</span>
      ),
    },
    {
      accessorKey: "database",
      header: t("sources.colDatabase"),
      cell: ({ row }) => (
        <span className="text-muted-foreground text-xs">{row.original.database ?? "—"}</span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <ConfirmDelete
          name={row.original.name}
          onConfirm={() => act(apiClient.mcp.removeSource(row.original.name))}
        />
      ),
    },
  ];

  const addTool = (
    <Button variant="outline" size="sm" onClick={() => setEditingTool("new")}>
      <Plus className="mr-2 size-3.5" />
      {t("tools.add")}
    </Button>
  );
  const addToolset = (
    <Button variant="outline" size="sm" onClick={() => setEditingToolset("new")}>
      <Plus className="mr-2 size-3.5" />
      {t("toolsets.add")}
    </Button>
  );
  const addSource = (
    <Button variant="outline" size="sm" onClick={() => setEditingSource("new")}>
      <Plus className="mr-2 size-3.5" />
      {t("sources.add")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="gateway">{t("tabGateway")}</TabsTrigger>
          <TabsTrigger value="tools">{t("tabTools")}</TabsTrigger>
          <TabsTrigger value="toolsets">{t("tabToolsets")}</TabsTrigger>
          <TabsTrigger value="sources">{t("tabSources")}</TabsTrigger>
          <TabsTrigger value="validate">{t("tabValidate")}</TabsTrigger>
          <TabsTrigger value="yaml">{t("tabYaml")}</TabsTrigger>
        </TabsList>

        <TabsContent value="gateway" className="mt-4">
          {gateway === null ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{t("gateway.title")}</CardTitle>
                  <StatusPill tone={gateway.running ? "success" : "error"}>
                    {gateway.running ? t("gateway.running") : t("gateway.stopped")}
                  </StatusPill>
                </div>
              </CardHeader>
              <CardContent>
                <Facts>
                  <FactRow
                    label={t("gateway.url")}
                    value={<span className="text-xs">{gateway.url}</span>}
                  />
                  <FactRow
                    label={t("gateway.toolCount")}
                    value={<span className="tabular-nums">{gateway.tool_count}</span>}
                  />
                  <FactRow
                    label={t("gateway.toolsetCount")}
                    value={<span className="tabular-nums">{gateway.toolset_count}</span>}
                  />
                  <FactRow
                    label={t("gateway.activeSessions")}
                    value={<span className="tabular-nums">{gateway.active_sessions}</span>}
                  />
                </Facts>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <div className="flex flex-col gap-3">
            {tools === null ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <DataTable
                columns={toolCols}
                data={filteredTools}
                toolbar={
                  <>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                      <SelectTrigger className="h-9 w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("tools.filterByType")}: all</SelectItem>
                        {toolTypes.map((ty) => (
                          <SelectItem key={ty} value={ty}>
                            <span className="text-xs">{ty}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {addTool}
                  </>
                }
                onRowClick={(tool) => setEditingTool(tool)}
                pageSize={15}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="toolsets" className="mt-4">
          {toolsets === null ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : (
            <div className="flex flex-col gap-3">
              <div>{addToolset}</div>
              {toolsets.length === 0 ? (
                <EmptyState icon={Database} title={t("toolsets.empty")} />
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {toolsets.map((ts) => (
                    <Card key={ts.name}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-sm font-medium">{ts.name}</CardTitle>
                          <div className="flex items-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground h-8 px-2"
                              aria-label={t("toolsets.editTitle")}
                              onClick={() => setEditingToolset(ts)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <ConfirmDelete
                              name={ts.name}
                              onConfirm={() => act(apiClient.mcp.removeToolset(ts.name))}
                            />
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <ul className="flex flex-col gap-1">
                          {ts.tools.map((tool) => (
                            <li key={tool} className="text-foreground text-xs">
                              {tool}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          {sources === null ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : sources.length === 0 ? (
            <EmptyState icon={Database} title={t("sources.empty")} action={addSource} />
          ) : (
            <DataTable
              columns={sourceCols}
              data={sources}
              toolbar={addSource}
              onRowClick={(s) => setEditingSource(s)}
              pageSize={15}
            />
          )}
        </TabsContent>

        <TabsContent value="validate" className="mt-4">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={validate}>
                <ShieldCheck className="mr-2 size-3.5" />
                {t("validate.runValidate")}
              </Button>
              <Button size="sm" variant="outline" onClick={build}>
                <Hammer className="mr-2 size-3.5" />
                {t("validate.runBuild")}
              </Button>
            </div>
            {report && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{t("validate.title")}</CardTitle>
                  <p className="text-muted-foreground text-xs">{t("validate.subtitle")}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-muted-foreground text-xs">
                    {t("validate.counts", {
                      sources: report.sources,
                      tools: report.tools,
                      toolsets: report.toolsets,
                    })}
                  </p>
                  <div>
                    <p className="text-foreground mb-1.5 text-xs font-medium">
                      {t("validate.issues")}
                    </p>
                    <Issues issues={report.issues} />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="yaml" className="mt-4">
          <ToolsYaml onSaved={reload} />
        </TabsContent>
      </Tabs>

      <ToolDialog
        key={editingTool === "new" ? "new" : (editingTool?.name ?? "closed")}
        open={editingTool !== null}
        onOpenChange={(open) => !open && setEditingTool(null)}
        initial={editingTool === "new" ? undefined : (editingTool ?? undefined)}
        sources={sourceNames}
        onSaved={reload}
      />
      <ToolsetDialog
        key={editingToolset === "new" ? "new" : (editingToolset?.name ?? "closed")}
        open={editingToolset !== null}
        onOpenChange={(open) => !open && setEditingToolset(null)}
        initial={editingToolset === "new" ? undefined : (editingToolset ?? undefined)}
        tools={toolNames}
        onSaved={reload}
      />
      <SourceDialog
        key={editingSource === "new" ? "new" : (editingSource?.name ?? "closed")}
        open={editingSource !== null}
        onOpenChange={(open) => !open && setEditingSource(null)}
        initial={editingSource === "new" ? undefined : (editingSource ?? undefined)}
        onSaved={reload}
      />
    </div>
  );
}
