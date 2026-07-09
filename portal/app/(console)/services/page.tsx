"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { apiClient } from "@/lib/ontology/api-client";
import type { Service } from "@/lib/ontology/types";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { SectionHeader } from "@/components/console/section-header";
import { StatusBadge } from "@/components/console/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";
import { fmtRows } from "@/lib/ontology/format";

export default function ServicesPage() {
  const t = useTranslations("services");
  const tc = useTranslations("common");
  const router = useRouter();
  const [services, setServices] = useState<Service[] | null>(null);

  useEffect(() => {
    apiClient.services
      .list()
      .then(setServices)
      .catch((e) => console.error("services load failed", e));
  }, []);

  async function remove(name: string) {
    const res = await apiClient.services.remove(name);
    if (res.ok) {
      toast.success(t("removedToast", { name }));
      setServices((prev) => prev?.filter((s) => s.name !== name) ?? null);
    } else {
      toast.error(res.message);
    }
  }

  const columns: ColumnDef<Service, unknown>[] = [
    {
      accessorKey: "name",
      header: sortableHeader(t("colName")),
      cell: ({ row }) => (
        <span className="font-mono font-medium text-foreground">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "service_type",
      header: sortableHeader(t("colType")),
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.service_type === "database" ? t("typeDatabase") : t("typeApi")}
        </span>
      ),
    },
    {
      accessorKey: "host",
      header: sortableHeader(t("colHost")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.host}</span>
      ),
    },
    {
      accessorKey: "status",
      header: sortableHeader(t("colStatus")),
      cell: ({ row }) => <StatusBadge kind="status" value={row.original.status} />,
    },
    {
      accessorKey: "last_sync_at",
      header: sortableHeader(t("colLastSync")),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.last_sync_at ? fmtDate(row.original.last_sync_at) : tc("never")}
        </span>
      ),
    },
    {
      accessorKey: "tables_synced",
      header: sortableHeader(t("colTablesSynced")),
      cell: ({ row }) => (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {row.original.tables_synced > 0 ? fmtRows(row.original.tables_synced) : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{tc("actions")}</span>,
      cell: ({ row }) => (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground hover:text-red-600"
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onClick={(e) => e.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("removeConfirmTitle", { name: row.original.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t("removeConfirmBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => remove(row.original.name)}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {t("removeConfirmAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button size="sm" onClick={() => router.push("/services/add")}>
            <Plus className="mr-2 size-3.5" />
            {t("addService")}
          </Button>
        }
      />
      {services === null ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : services.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm font-medium text-foreground">{t("empty")}</p>
          <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => router.push("/catalog")}
          >
            {t("addService")}
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={services}
          searchPlaceholder={t("searchPlaceholder")}
          onRowClick={(s) => router.push(`/services/${s.name}`)}
        />
      )}
    </div>
  );
}
