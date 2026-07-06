"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { accountBalance, listAccounts, listInvoices } from "@/lib/api";
import type { FamilyAccount } from "@/lib/types";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { money } from "@/lib/format";

interface Row {
  account: FamilyAccount;
  balance: number;
  overdue: number;
  due: number;
}

export default function AdminBillingPage() {
  const t = useTranslations("adminBilling");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin", "finance_admin"]);
  const router = useRouter();

  const { data: rows } = useLoad(async () => {
    if (!user) return undefined;
    const accounts = await listAccounts();
    return Promise.all(
      accounts.map(async (account) => {
        const invoices = await listInvoices(account.id);
        return {
          account,
          balance: accountBalance(account),
          overdue: invoices.filter((i) => i.status === "overdue").length,
          due: invoices.filter((i) => i.status === "due").length,
        };
      }),
    );
  }, [user]);

  if (!user || !rows) return null;

  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: "family",
      accessorFn: (r) => r.account.familyName,
      header: sortableHeader(t("colFamily")),
      cell: ({ row }) => <span className="font-medium">{row.original.account.familyName}</span>,
    },
    {
      id: "school",
      accessorFn: (r) => getSchoolConfig(r.account.schoolSlug)?.shortName ?? r.account.schoolSlug,
      header: sortableHeader(t("colSchool")),
    },
    {
      id: "application",
      accessorFn: (r) => r.account.applicationId,
      header: t("colApplication"),
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.account.applicationId}</span>
      ),
    },
    {
      id: "plan",
      accessorFn: (r) => r.account.plan?.kind ?? "",
      header: t("colPlan"),
      cell: ({ row }) =>
        row.original.account.plan ? (
          t(`plan_${row.original.account.plan.kind}`)
        ) : (
          <span className="text-xs text-muted-foreground">{t("noPlan")}</span>
        ),
    },
    {
      id: "balance",
      accessorFn: (r) => r.balance,
      header: sortableHeader(t("colBalance")),
      cell: ({ row }) => <span className="font-medium">{money(row.original.balance)}</span>,
    },
    {
      id: "flags",
      header: t("colFlags"),
      cell: ({ row }) => (
        <span className="flex gap-1.5">
          {row.original.account.hold && (
            <Badge variant="secondary" className="bg-red-50 text-red-700">
              {t("hold")}
            </Badge>
          )}
          {row.original.overdue > 0 && (
            <Badge variant="secondary" className="bg-amber-50 text-amber-700">
              {t("overdueN", { n: row.original.overdue })}
            </Badge>
          )}
          {row.original.due > 0 && (
            <Badge variant="secondary">{t("dueN", { n: row.original.due })}</Badge>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/billing/config">{t("feeConfig")}</Link>
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        searchPlaceholder={t("searchPlaceholder")}
        onRowClick={(r) => router.push(`/admin/billing/${r.account.id}`)}
      />
    </div>
  );
}
