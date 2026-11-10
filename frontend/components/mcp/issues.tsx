"use client";

import { useTranslations } from "next-intl";
import type { ComplianceIssue } from "@/lib/ontology/types";
import { StatusPill } from "@/components/console/status-pill";

/** The compliance issue list shared by the Validate tab and the tools.yaml editor. */
export function Issues({ issues }: { issues: ComplianceIssue[] }) {
  const t = useTranslations("mcp.validate");
  if (issues.length === 0) return <p className="text-muted-foreground text-xs">{t("noIssues")}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-2 rounded-md border px-3 py-2">
          <StatusPill tone={issue.severity === "error" ? "error" : "warning"} className="mt-0.5">
            {issue.severity === "error" ? t("severityError") : t("severityWarning")}
          </StatusPill>
          <span className="text-foreground text-xs">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
