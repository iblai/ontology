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
        <p className="text-muted-foreground text-sm">{t("noReport")}</p>
      </div>
    );
  }

  const passed = report.status === "passed";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-md border p-3">
        <StatusBadge kind="safety" value={report.status} />
        <p className="text-foreground text-sm">
          {passed ? t("overallPassed") : t("overallFailed")}
        </p>
      </div>

      <ul className="flex flex-col gap-1">
        {report.details.map((test) => {
          const Icon =
            test.result === "passed" ? Check : test.result === "failed" ? X : AlertTriangle;
          return (
            <li
              key={test.test_name}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "size-3.5",
                    test.result === "failed" ? "text-red-600" : "text-muted-foreground",
                  )}
                />
                <span className="text-foreground text-xs">{test.test_name}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{test.detail}</span>
                <StatusBadge kind="safetyTest" value={test.result} />
              </span>
            </li>
          );
        })}
      </ul>

      {report.remediation_sql && (
        <div className="flex flex-col gap-1.5">
          <p className="text-foreground text-xs font-medium">{t("remediation")}</p>
          <CodeBlock code={report.remediation_sql} language="sql" />
        </div>
      )}
    </div>
  );
}
