"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { listSisRecords, resolveDuplicate } from "@/lib/api";
import type { SisRecord } from "@/lib/types";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";

// SIS records created on acceptance. PDF §2.5: declined/waitlisted are never created.
export default function SisPage() {
  const t = useTranslations("sis");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin"]);
  const { data: records, reload } = useLoad(async () => {
    if (!user) return undefined;
    return listSisRecords();
  }, [user]);

  if (!user || !records) return null;

  const resolve = async (id: string, action: "merge" | "keep") => {
    await resolveDuplicate(id, action);
    toast.success(action === "merge" ? t("merged") : t("kept"));
    await reload();
  };

  const columns: ColumnDef<SisRecord, unknown>[] = [
    {
      id: "kind",
      accessorFn: (r) => r.kind,
      header: sortableHeader(t("colKind")),
      cell: ({ row }) => <Badge variant="secondary">{t(`kind_${row.original.kind}`)}</Badge>,
    },
    {
      id: "name",
      accessorFn: (r) => r.fields.name ?? "",
      header: sortableHeader(t("colName")),
      cell: ({ row }) => <span className="font-medium">{row.original.fields.name}</span>,
    },
    {
      id: "details",
      accessorFn: (r) =>
        Object.entries(r.fields)
          .filter(([k]) => k !== "name")
          .map(([, v]) => v)
          .join(" "),
      header: t("colDetails"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {Object.entries(row.original.fields)
            .filter(([k]) => k !== "name")
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
        </span>
      ),
    },
    {
      id: "family",
      accessorFn: (r) => r.familyId,
      header: sortableHeader(t("colFamily")),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.familyId}</span>,
    },
    {
      id: "duplicate",
      header: t("colDuplicate"),
      cell: ({ row }) =>
        row.original.duplicateOfId ? (
          <span className="flex items-center gap-2">
            <Badge className="gap-1 bg-red-50 text-red-700" variant="secondary">
              <Copy className="size-3" />
              {t("duplicate")}
            </Badge>
            <Button size="sm" variant="outline" onClick={() => resolve(row.original.id, "merge")}>
              {t("merge")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => resolve(row.original.id, "keep")}>
              {t("keepBoth")}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <Alert className="mb-4">
        <AlertDescription>{t("policyNote")}</AlertDescription>
      </Alert>
      <DataTable columns={columns} data={records} searchPlaceholder={t("searchPlaceholder")} />
    </div>
  );
}
