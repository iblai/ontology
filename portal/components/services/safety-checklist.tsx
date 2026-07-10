"use client";

import { useTranslations } from "next-intl";
import { Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SafetyReport } from "@/lib/ontology/types";
import { StatusBadge } from "@/components/console/status-badge";
import { CodeBlock } from "@/components/console/code-block";

export function SafetyChecklist({ report }: { report: SafetyReport | undefined }) {
  const t = useTranslations("serviceDetail.safety");

  if (!report) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center">
        <p className="text-sm text-muted-foreground">{t("noReport")}</p>
      </div>
    );
  }

  const passed = report.status === "passed";

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border p-3",
          passed ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50",
        )}
      >
        {passed ? (
          <Check className="size-4 text-emerald-600" />
        ) : (
          <X className="size-4 text-red-600" />
        )}
        <p className={cn("text-sm font-medium", passed ? "text-emerald-800" : "text-red-800")}>
          {passed ? t("overallPassed") : t("overallFailed")}
        </p>
      </div>

      <ul className="flex flex-col gap-1">
        {report.details.map((test) => {
          const Icon =
            test.result === "passed" ? Check : test.result === "failed" ? X : AlertTriangle;
          const tone =
            test.result === "passed"
              ? "text-emerald-600"
              : test.result === "failed"
                ? "text-red-600"
                : "text-amber-600";
          return (
            <li
              key={test.test_name}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <Icon className={cn("size-3.5", tone)} />
                <span className="font-mono text-xs text-foreground">{test.test_name}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{test.detail}</span>
                <StatusBadge kind="safetyTest" value={test.result} />
              </span>
            </li>
          );
        })}
      </ul>

      {report.remediation_sql && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-foreground">{t("remediation")}</p>
          <CodeBlock code={report.remediation_sql} language="sql" />
        </div>
      )}
    </div>
  );
}
