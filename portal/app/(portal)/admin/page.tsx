"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarCheck, ClipboardCheck, CreditCard } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { accountBalance, listAccounts, listApplications } from "@/lib/api";
import type { ApplicationStatus } from "@/lib/types";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { money } from "@/lib/format";

const PIPELINE: ApplicationStatus[] = [
  "draft",
  "submitted",
  "incomplete",
  "under_review",
  "interview_required",
  "accepted",
  "waitlisted",
  "declined",
  "enrollment_in_progress",
  "enrolled",
];

export default function AdminDashboard() {
  const t = useTranslations("adminDashboard");
  const ts = useTranslations("status");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin", "finance_admin"]);

  const { data } = useLoad(async () => {
    if (!user) return undefined;
    const [apps, accounts] = await Promise.all([listApplications(), listAccounts()]);
    return { apps, accounts };
  }, [user]);

  if (!user || !data) return null;
  const { apps, accounts } = data;
  const isFinance = user.role === "finance_admin";

  const students = apps.flatMap((a) => a.students);
  const countByStatus = (s: ApplicationStatus) => students.filter((st) => st.status === s).length;

  const needsAttention = [
    {
      icon: CalendarCheck,
      label: t("interviewsPending"),
      count: apps.filter((a) => a.status === "interview_required").length,
      href: "/admin/interviews",
    },
    {
      icon: AlertTriangle,
      label: t("incompleteApps"),
      count: apps.filter((a) => a.status === "incomplete").length,
      href: "/admin/applications?status=incomplete",
    },
    {
      icon: CreditCard,
      label: t("unpaidFees"),
      count: apps.filter((a) => a.fee.status === "unpaid" && a.status !== "draft").length,
      href: "/admin/applications",
    },
    {
      icon: ClipboardCheck,
      label: t("placementToReview"),
      count: students.filter((s) =>
        Object.values(s.placement).some((p) => p.status === "completed"),
      ).length,
      href: "/admin/placement",
    },
  ];

  const totalOutstanding = accounts.reduce((sum, a) => sum + Math.max(accountBalance(a), 0), 0);
  const holds = accounts.filter((a) => a.hold).length;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {!isFinance && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {PIPELINE.map((s) => (
              <Link key={s} href={`/admin/applications?status=${s}`}>
                <Card className="py-4 transition-colors hover:border-primary/40">
                  <CardContent className="px-4">
                    <p className="text-2xl font-semibold">{countByStatus(s)}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{ts(s)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <h2 className="mt-8 mb-3 text-base font-semibold">{t("needsAttention")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {needsAttention.map((item) => (
              <Link key={item.label} href={item.href}>
                <Card className="py-4 transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center gap-3 px-4">
                    <item.icon className="size-5 text-muted-foreground" />
                    <div>
                      <p className="text-lg font-semibold">{item.count}</p>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="mt-8 mb-3 text-base font-semibold">{t("billingOverview")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="py-4">
          <CardContent className="px-4">
            <p className="text-lg font-semibold">{money(totalOutstanding)}</p>
            <p className="text-xs text-muted-foreground">{t("outstandingBalances")}</p>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4">
            <p className="text-lg font-semibold">{accounts.length}</p>
            <p className="text-xs text-muted-foreground">{t("familyAccounts")}</p>
          </CardContent>
        </Card>
        <Link href="/admin/billing">
          <Card className="py-4 transition-colors hover:border-primary/40">
            <CardContent className="px-4">
              <p className="text-lg font-semibold">{holds}</p>
              <p className="text-xs text-muted-foreground">{t("activeHolds")}</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
