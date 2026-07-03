"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { listSchoolConfigs } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { fmtDate, money } from "@/lib/format";

// ponytail: read-only view — fee/tuition config lives in lib/schools/*.ts;
// a config editor lands when schools need self-service (PLAN §9).
export default function BillingConfigPage() {
  const t = useTranslations("billingConfig");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin", "finance_admin"]);
  if (!user) return null;

  const schools =
    user.role === "central_admin" || user.role === "finance_admin"
      ? listSchoolConfigs()
      : listSchoolConfigs().filter((s) => s.slug === user.schoolSlug);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="space-y-6">
        {schools.map((cfg) => (
          <Card key={cfg.slug}>
            <CardHeader>
              <CardTitle className="text-base">{cfg.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 font-semibold">{t("applicationFee")}</p>
                  <p>
                    {money(cfg.fee.amountCents)}{" "}
                    <span className="text-muted-foreground">
                      {cfg.fee.basis === "family" ? t("perFamily") : t("perStudent")}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(`refundability_${cfg.fee.refundability}`)}
                    {cfg.fee.lateFeeCents
                      ? ` · ${t("lateFee", {
                          amount: money(cfg.fee.lateFeeCents),
                          date: fmtDate(cfg.fee.lateFeeAfter),
                        })}`
                      : ""}
                  </p>
                </div>
                <div>
                  <p className="mb-1 font-semibold">{t("paymentPlans")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {cfg.planKinds.map((k) => (
                      <Badge key={k} variant="secondary">
                        {t(`plan_${k}`)}
                      </Badge>
                    ))}
                  </div>
                  {cfg.reenrollmentWindow && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("reenrollWindow", {
                        opens: fmtDate(cfg.reenrollmentWindow.opens),
                        deadline: fmtDate(cfg.reenrollmentWindow.deadline),
                      })}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="mb-2 font-semibold">{t("tuitionMatrix")}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colGrades")}</TableHead>
                      <TableHead>{t("colProgram")}</TableHead>
                      <TableHead className="text-right">{t("colAnnual")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cfg.tuition.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>{row.gradeBand}</TableCell>
                        <TableCell>
                          {cfg.programs.find((p) => p.id === row.programId)?.label ?? row.programId}
                        </TableCell>
                        <TableCell className="text-right">{money(row.annualCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {cfg.standardFees.length > 0 && (
                <div>
                  <p className="mb-2 font-semibold">{t("standardFees")}</p>
                  <ul className="space-y-1">
                    {cfg.standardFees.map((f) => (
                      <li key={f.chargeType} className="flex justify-between">
                        <span>{f.label}</span>
                        <span>{money(f.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-muted-foreground">{t("editNote")}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
