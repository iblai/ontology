"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { FileWarning, RefreshCw, ShieldCheck } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type { BackendConfigFile, BackendConfigSnapshot } from "@/lib/ontology/types";
import { SectionHeader } from "@/components/console/section-header";
import { CodeBlock } from "@/components/console/code-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime } from "@/lib/format";

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

export default function BackendConfigPage() {
  const t = useTranslations("backendConfig");
  const [snapshot, setSnapshot] = useState<BackendConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await apiClient.config.snapshot());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const files = snapshot?.files ?? [];
  const present = files.filter((f) => f.exists);

  return (
    <div className="space-y-6">
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            {t("refresh")}
          </Button>
        }
      />

      <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
        {t("maskedNotice")}
      </p>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && !snapshot && (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full max-w-2xl" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {snapshot && (
        <Tabs defaultValue={present[0]?.id ?? files[0]?.id}>
          <TabsList className="h-auto flex-wrap">
            {files.map((f) => (
              <TabsTrigger key={f.id} value={f.id} className="gap-1.5">
                {t(`file_${f.id}`)}
                {!f.exists && <FileWarning className="size-3 text-muted-foreground" />}
              </TabsTrigger>
            ))}
          </TabsList>

          {files.map((f) => (
            <TabsContent key={f.id} value={f.id} className="mt-4">
              <ConfigFileView file={f} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function ConfigFileView({ file }: { file: BackendConfigFile }) {
  const t = useTranslations("backendConfig");

  if (!file.exists) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {file.optional
            ? t("optionalMissing", { path: file.path })
            : t("missing", { path: file.path })}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="font-mono text-sm font-medium">{file.path}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {fmtBytes(file.sizeBytes)} · {t("updated")} {fmtDateTime(file.modifiedAt ?? undefined)}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        {file.summary.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {file.summary.map((s) => (
              <Badge key={s.label} variant="secondary" className="max-w-full">
                <span className="truncate">
                  {s.label}: {s.value}
                </span>
              </Badge>
            ))}
          </div>
        )}
        {file.error && (
          <p className="text-xs text-amber-700">
            {t("parseError")}: {file.error}
          </p>
        )}
        {file.content !== null && (
          <CodeBlock
            code={file.content}
            language={file.format === "yaml" ? "yaml" : file.format}
            className="max-h-[32rem] overflow-y-auto"
          />
        )}
      </CardContent>
    </Card>
  );
}
