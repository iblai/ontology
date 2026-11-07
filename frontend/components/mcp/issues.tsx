"use client";

import { useTranslations } from "next-intl";
import type { ComplianceIssue } from "@/lib/ontology/types";
import { cn } from "@/lib/utils";

/** The compliance issue list shared by the Validate tab and the tools.yaml editor. */
export function Issues({ issues }: { issues: ComplianceIssue[] }) {
  const t = useTranslations("mcp.validate");
  if (issues.length === 0) return <p className="text-xs text-emerald-600">{t("noIssues")}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-2 rounded-md border px-3 py-2">
          <span
            className={cn(
              "mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium",
              issue.severity === "error"
                ? "border-red-200 bg-red-100 text-red-800"
                : "border-amber-200 bg-amber-100 text-amber-800",
            )}
          >
            {issue.severity === "error" ? t("severityError") : t("severityWarning")}
          </span>
          <span className="text-foreground text-xs">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
