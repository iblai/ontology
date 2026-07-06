"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, FileText, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { PlacementBadge, StatusBadge } from "@/components/shared/status-badge";
import {
  getFamilyApplications,
  listAccountsForParent,
  startReenrollment,
  type FamilyApplicationView,
} from "@/lib/api";
import { getSchoolConfig, listSchoolConfigs } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";

export default function ParentDashboard() {
  const t = useTranslations("parent");
  const user = useRequireRole(["parent"]);
  const router = useRouter();

  const { data, loading } = useLoad(async () => {
    if (!user) return undefined;
    const [apps, accounts] = await Promise.all([
      getFamilyApplications(user.email!),
      listAccountsForParent(user.email!),
    ]);
    return { apps, accounts };
  }, [user]);

  if (!user || loading || !data) return null;
  const { apps, accounts } = data;
  const holdAccount = accounts.find((a) => a.hold);

  const nextAction = (app: FamilyApplicationView) => {
    const account = accounts.find((a) => a.applicationId === app.id);
    if (app.status === "draft") {
      return { label: t("resumeApplication"), href: `/apply/${app.schoolSlug}?draft=${app.id}` };
    }
    if (app.status === "incomplete") {
      return { label: t("updateApplication"), href: `/apply/${app.schoolSlug}?draft=${app.id}` };
    }
    if (app.status === "accepted" && account && !account.plan) {
      return { label: t("choosePaymentPlan"), href: "/parent/billing/plans" };
    }
    return { label: t("viewApplication"), href: `/parent/applications/${app.id}` };
  };

  const reenroll = async (app: FamilyApplicationView) => {
    const draft = await startReenrollment(app.id);
    toast.success(t("reenrollStarted"));
    router.push(`/apply/${app.schoolSlug}?draft=${draft.id}`);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {holdAccount && (
        <Alert className="mb-4 border-red-200 bg-red-50 text-red-900">
          <AlertTriangle className="size-4" />
          <AlertTitle>{t("holdTitle")}</AlertTitle>
          <AlertDescription>
            {holdAccount.hold!.reason} —{" "}
            <Link href="/parent/billing" className="underline">
              {t("viewBilling")}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {apps.length === 0 && (
        <EmptyState
          title={t("noApplications")}
          description={t("noApplicationsHint")}
          action={
            <div className="flex gap-2">
              {listSchoolConfigs().map((s) => (
                <Button key={s.slug} asChild variant="outline">
                  <Link href={`/apply/${s.slug}`}>{t("applyTo", { school: s.name })}</Link>
                </Button>
              ))}
            </div>
          }
        />
      )}

      <div className="space-y-4">
        {apps.map((app) => {
          const cfg = getSchoolConfig(app.schoolSlug);
          const action = nextAction(app);
          const openInfoRequests = app.infoRequests.filter((r) => !r.resolvedAt);
          const latestNotice = app.decisionNotices[app.decisionNotices.length - 1];
          return (
            <Card key={app.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {cfg?.name ?? app.schoolSlug}
                    <StatusBadge status={app.status} />
                    {app.isReenrollment && (
                      <Badge variant="secondary" className="text-[11px]">
                        {t("reenrollment")}
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {app.id} · {app.programYear}
                    {app.submittedAt
                      ? ` · ${t("submittedOn", { date: fmtDate(app.submittedAt) })}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {app.status === "enrolled" && (
                    <Button variant="outline" size="sm" onClick={() => reenroll(app)}>
                      <RefreshCw className="size-3.5" />
                      {t("reenrollButton")}
                    </Button>
                  )}
                  <Button asChild size="sm">
                    <Link href={action.href}>
                      {action.label}
                      <ArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {openInfoRequests.length > 0 && (
                  <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                    <FileText className="size-4" />
                    <AlertTitle>{t("infoRequestedTitle")}</AlertTitle>
                    <AlertDescription>
                      {openInfoRequests.map((r) => (
                        <p key={r.id}>{r.items}</p>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}
                {latestNotice && (
                  <Alert className="border-blue-200 bg-blue-50 text-blue-900">
                    <AlertTitle>{t("decisionNotice")}</AlertTitle>
                    <AlertDescription className="whitespace-pre-wrap">
                      {latestNotice.body}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {app.students.map((s) => {
                    const program = cfg?.programs.find((p) => p.id === s.program);
                    const showPlacement = ["enrollment_in_progress", "enrolled"].includes(s.status);
                    return (
                      <div key={s.id} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {s.legalFirstName} {s.legalLastName}
                          </p>
                          <StatusBadge status={s.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {s.gradeLevel === "K"
                            ? t("kindergarten")
                            : t("gradeN", { n: s.gradeLevel })}
                          {program ? ` · ${program.label}` : ""}
                        </p>
                        {showPlacement && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground">{t("math")}</span>
                            <PlacementBadge status={s.placement.math.status} />
                            <span className="text-[11px] text-muted-foreground">
                              {t("languageArts")}
                            </span>
                            <PlacementBadge status={s.placement.languageArts.status} />
                          </div>
                        )}
                        {s.courseEnrollments.length > 0 && (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {t("coursesAssigned", { n: s.courseEnrollments.length })}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
