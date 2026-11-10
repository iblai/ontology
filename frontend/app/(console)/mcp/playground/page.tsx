"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type { McpTool } from "@/lib/ontology/types";
import { SectionHeader } from "@/components/console/section-header";
import { CodeBlock } from "@/components/console/code-block";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export default function PlaygroundPage() {
  const t = useTranslations("mcp.playground");
  const tc = useTranslations("common");
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [toolName, setToolName] = useState<string>("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string>("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    apiClient.mcp
      .tools()
      .then(setTools)
      .catch((e) => console.error("playground load failed", e));
  }, []);

  const tool = tools?.find((t) => t.name === toolName);

  function selectTool(name: string) {
    setToolName(name);
    const t = tools?.find((x) => x.name === name);
    const init: Record<string, string> = {};
    t?.parameters.forEach((p) => {
      init[p.name] = "";
    });
    setParams(init);
    setResult("");
  }

  async function run() {
    if (!toolName) return;
    setRunning(true);
    try {
      const typedParams: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) {
        const param = tool?.parameters.find((p) => p.name === k);
        if (param?.type === "integer" && v) typedParams[k] = Number(v);
        else if (v) typedParams[k] = v;
      }
      const r = await apiClient.mcp.test(toolName, typedParams);
      if (r.ok) {
        setResult(JSON.stringify(r.result, null, 2));
        toast.success(t("ranToast"));
      } else {
        setResult(JSON.stringify(r, null, 2));
        toast.error(t("failedToast"));
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />
      {tools === null ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("pickTool")}</Label>
              <Select value={toolName} onValueChange={selectTool}>
                <SelectTrigger>
                  <SelectValue placeholder={t("pickTool")} />
                </SelectTrigger>
                <SelectContent>
                  {tools.map((tool) => (
                    <SelectItem key={tool.name} value={tool.name}>
                      <span className="text-xs">{tool.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {tool && (
              <div className="flex flex-col gap-3 rounded-lg border p-4">
                <div>
                  <p className="text-foreground text-sm font-medium">{tool.name}</p>
                  <p className="text-muted-foreground text-xs">{tool.description}</p>
                </div>
                <div className="flex flex-col gap-3">
                  <p className="text-foreground text-xs font-medium">{t("parameters")}</p>
                  {tool.parameters.length === 0 ? (
                    <p className="text-muted-foreground text-xs">{tc("noResults")}</p>
                  ) : (
                    tool.parameters.map((p) => (
                      <div key={p.name} className="flex flex-col gap-1.5">
                        <Label className="text-xs">
                          {p.name}
                          {p.required && <span className="text-muted-foreground ml-1">*</span>}
                          <span className="text-muted-foreground ml-2">({p.type})</span>
                        </Label>
                        <Input
                          value={params[p.name] ?? ""}
                          onChange={(e) =>
                            setParams((prev) => ({ ...prev, [p.name]: e.target.value }))
                          }
                          className="text-xs"
                          placeholder={p.description}
                        />
                      </div>
                    ))
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={run} disabled={running || !toolName}>
                  <Play className="mr-2 size-3.5" />
                  {t("run")}
                </Button>
              </div>
            )}

            {!tool && (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-muted-foreground text-sm">{t("noTool")}</p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-foreground text-xs font-medium">{t("result")}</p>
            {result ? (
              <CodeBlock code={result} language="json" className="min-h-64" />
            ) : (
              <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed">
                <p className="text-muted-foreground text-sm">{t("noTool")}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
