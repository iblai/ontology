"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { parseAllDocuments } from "yaml";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import type { ComplianceIssue } from "@/lib/ontology/types";
import { Issues } from "@/components/mcp/issues";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

/** The raw tools.yaml: edited as text, parsed locally for syntax, validated server-side on save. */
export function ToolsYaml({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations("mcp.yaml");
  const tc = useTranslations("common");
  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [issues, setIssues] = useState<ComplianceIssue[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    apiClient.mcp
      .config()
      .then((c) => {
        setText(c.text);
        setOriginal(c.text);
        setIssues(null);
      })
      .catch((e) => console.error("tools.yaml load failed", e));
  }, []);
  useEffect(() => load(), [load]);

  const syntax = useMemo(() => {
    if (text == null) return null;
    for (const doc of parseAllDocuments(text)) {
      const err = doc.errors[0];
      if (err) return { line: err.linePos?.[0]?.line ?? 0, message: err.message.split("\n")[0] };
    }
    return null;
  }, [text]);

  async function save() {
    if (text == null) return;
    setSaving(true);
    try {
      const r = await apiClient.mcp.saveConfig(text);
      if (r.ok) {
        toast.success(r.message || tc("saved"));
        setOriginal(text);
        setIssues(null);
        onSaved();
      } else {
        setIssues(r.issues);
        toast.error(t("rejected"));
      }
    } catch {
      toast.error(tc("failed"));
    } finally {
      setSaving(false);
    }
  }

  if (text == null) return <Skeleton className="h-64 rounded-lg" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{t("subtitle")}</p>
      <Textarea
        aria-label={t("title")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="h-[60vh] font-mono text-xs"
      />
      {syntax && (
        <p className="text-muted-foreground text-xs">
          {t("syntaxError", { line: syntax.line, message: syntax.message })}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={saving || Boolean(syntax) || text === original}>
          {t("save")}
        </Button>
        <Button size="sm" variant="outline" onClick={load} disabled={saving}>
          {t("reload")}
        </Button>
      </div>
      {issues && <Issues issues={issues} />}
    </div>
  );
}
