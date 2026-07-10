"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CATALOG, DOMAINS } from "@/lib/ontology/catalog";
import type { CatalogEntry } from "@/lib/ontology/types";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { SectionHeader } from "@/components/console/section-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function CatalogPage() {
  const t = useTranslations("catalog");
  const router = useRouter();
  const [domain, setDomain] = useState<string>("all");

  const filtered = useMemo(() => {
    if (domain === "all") return CATALOG;
    return CATALOG.filter((c) => c.domain === domain);
  }, [domain]);

  const columns: ColumnDef<CatalogEntry, unknown>[] = [
    {
      accessorKey: "key",
      header: sortableHeader(t("colKey")),
      cell: ({ row }) => (
        <span className="font-mono font-medium text-foreground">{row.original.key}</span>
      ),
    },
    {
      accessorKey: "display_name",
      header: sortableHeader(t("colName")),
      cell: ({ row }) => <span className="text-foreground">{row.original.display_name}</span>,
    },
    {
      accessorKey: "type",
      header: sortableHeader(t("colType")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.type}</span>
      ),
    },
    {
      accessorKey: "domain",
      header: sortableHeader(t("colDomain")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.domain}</span>
      ),
    },
    {
      accessorKey: "default_toolset",
      header: sortableHeader(t("colDefaultToolset")),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.default_toolset}
        </span>
      ),
    },
    {
      accessorKey: "skill",
      header: t("colSkill"),
      cell: ({ row }) =>
        row.original.skill ? (
          <span className="font-mono text-xs text-muted-foreground">{row.original.skill}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle", { n: CATALOG.length, domains: DOMAINS.length })}
        actions={
          <Select value={domain} onValueChange={setDomain}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("domainAll")}</SelectItem>
              {DOMAINS.map((d) => (
                <SelectItem key={d} value={d}>
                  <span className="font-mono text-xs">{d}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder={t("searchPlaceholder")}
        onRowClick={(c) => router.push(`/catalog/${c.key}`)}
        pageSize={15}
      />
    </div>
  );
}
