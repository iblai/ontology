"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle, ShieldCheck, Hammer } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type { GatewayHealth, McpTool, McpToolset, ComplianceReport } from "@/lib/ontology/types";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { SectionHeader } from "@/components/console/section-header";
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
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function McpPage() {
  const t = useTranslations("mcp");
  const [gateway, setGateway] = useState<GatewayHealth | null>(null);
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [toolsets, setToolsets] = useState<McpToolset[] | null>(null);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    const err = (e: unknown) => console.error("mcp load failed", e);
    apiClient.mcp.status().then(setGateway).catch(err);
    apiClient.mcp.tools().then(setTools).catch(err);
    apiClient.mcp.toolsets().then(setToolsets).catch(err);
    apiClient.mcp.validate().then(setReport).catch(err);
  }, []);

  async function validate() {
    const r = await apiClient.mcp.validate();
    setReport(r);
    toast.success(t("validate.title"));
  }

  async function build() {
    const r = await apiClient.mcp.build();
    toast.success(t("validate.buildToast", { n: r.nativeTools }));
  }

  const toolTypes = Array.from(new Set((tools ?? []).map((t) => t.type)));
  const filteredTools =
    typeFilter === "all" ? (tools ?? []) : (tools ?? []).filter((t) => t.type === typeFilter);

  const toolCols: ColumnDef<McpTool, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("tools.colName")),
      cell: ({ row }) => (
        <span className="font-mono text-xs font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "type",
      header: sortableHeader(t("tools.colType")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.type}</span>
      ),
    },
    {
      accessorKey: "source",
      header: sortableHeader(t("tools.colSource")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.source}</span>
      ),
    },
    {
      accessorKey: "description",
      header: t("tools.colDescription"),
      cell: ({ row }) => (
        <span className="text-xs text-foreground">{row.original.description.slice(0, 60)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      <Tabs defaultValue="gateway">
        <TabsList>
          <TabsTrigger value="gateway">{t("tabGateway")}</TabsTrigger>
          <TabsTrigger value="tools">{t("tabTools")}</TabsTrigger>
          <TabsTrigger value="toolsets">{t("tabToolsets")}</TabsTrigger>
          <TabsTrigger value="validate">{t("tabValidate")}</TabsTrigger>
        </TabsList>

        <TabsContent value="gateway" className="mt-4">
          {gateway === null ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium">{t("gateway.title")}</CardTitle>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-xs font-medium",
                      gateway.running ? "text-emerald-600" : "text-red-600",
                    )}
                  >
                    {gateway.running ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <XCircle className="size-3.5" />
                    )}
                    {gateway.running ? t("gateway.running") : t("gateway.stopped")}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Row
                  label={t("gateway.url")}
                  value={<span className="font-mono text-xs">{gateway.url}</span>}
                />
                <Row
                  label={t("gateway.toolCount")}
                  value={<span className="font-mono">{gateway.tool_count}</span>}
                />
                <Row
                  label={t("gateway.toolsetCount")}
                  value={<span className="font-mono">{gateway.toolset_count}</span>}
                />
                <Row
                  label={t("gateway.activeSessions")}
                  value={<span className="font-mono">{gateway.active_sessions}</span>}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <div className="flex flex-col gap-3">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("tools.filterByType")}: all</SelectItem>
                {toolTypes.map((ty) => (
                  <SelectItem key={ty} value={ty}>
                    <span className="font-mono text-xs">{ty}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tools === null ? (
              <Skeleton className="h-64 rounded-lg" />
            ) : (
              <DataTable
                columns={toolCols}
                data={filteredTools}
                onRowClick={(tool) => {
                  const params = tool.parameters.map((p) => `${p.name}: ${p.type}`).join(", ");
                  const stmt = tool.statement ? `\n  ${tool.statement}` : "";
                  const detail = `${tool.description}\n\nparams: ${params || "none"}${stmt}`;
                  toast(detail, { duration: 6000 });
                }}
                pageSize={15}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="toolsets" className="mt-4">
          {toolsets === null ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {toolsets.map((ts) => (
                <Card key={ts.name}>
                  <CardHeader className="pb-2">
                    <CardTitle className="font-mono text-sm font-medium">{ts.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-1">
                      {ts.tools.map((tool) => (
                        <li key={tool} className="font-mono text-xs text-foreground">
                          {tool}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
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
                  <p className="text-xs text-muted-foreground">{t("validate.subtitle")}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="font-mono text-xs text-muted-foreground">
                    {t("validate.counts", {
                      sources: report.sources,
                      tools: report.tools,
                      toolsets: report.toolsets,
                    })}
                  </p>
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-foreground">
                      {t("validate.issues")}
                    </p>
                    {report.issues.length === 0 ? (
                      <p className="text-xs text-emerald-600">{t("validate.noIssues")}</p>
                    ) : (
                      <ul className="flex flex-col gap-1.5">
                        {report.issues.map((issue, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-md border px-3 py-2"
                          >
                            <span
                              className={cn(
                                "mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium",
                                issue.severity === "error"
                                  ? "border-red-200 bg-red-100 text-red-800"
                                  : "border-amber-200 bg-amber-100 text-amber-800",
                              )}
                            >
                              {issue.severity === "error"
                                ? t("validate.severityError")
                                : t("validate.severityWarning")}
                            </span>
                            <span className="text-xs text-foreground">{issue.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
