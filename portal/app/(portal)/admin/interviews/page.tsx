"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { listApplications, recordInterviewOutcome } from "@/lib/api";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";

// Interview queue — network-school workflow. PDF §2.3.
export default function InterviewsPage() {
  const t = useTranslations("interviews");
  const user = useRequireRole(["network_admin", "central_admin"]);
  const { data: apps, reload } = useLoad(async () => {
    if (!user) return undefined;
    return listApplications({ status: "interview_required" });
  }, [user]);

  if (!user || !apps) return null;

  const outcome = async (id: string, o: "proceed" | "request_info" | "decline" | "waitlist") => {
    try {
      await recordInterviewOutcome(id, o);
      toast.success(t("outcomeRecorded"));
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {apps.length === 0 && <EmptyState title={t("empty")} description={t("emptyHint")} />}
      <div className="space-y-4">
        {apps.map((app) => {
          const cfg = getSchoolConfig(app.schoolSlug);
          const parent = app.guardians[0];
          return (
            <Card key={app.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {parent ? `${parent.lastName} Family` : app.id}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {cfg?.name} · {app.id}
                    {app.submittedAt
                      ? ` · ${t("submitted", { date: fmtDate(app.submittedAt) })}`
                      : ""}
                  </span>
                </CardTitle>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/applications/${app.id}`}>{t("open")}</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  {app.students
                    .map(
                      (s) => `${s.legalFirstName} (${s.gradeLevel === "K" ? "K" : s.gradeLevel})`,
                    )
                    .join(", ")}
                  {" · "}
                  {t("notesCount", { n: app.interview?.notes.length ?? 0 })}
                </p>
                {app.interview?.outcome ? (
                  <p className="text-xs text-muted-foreground">
                    {t("outcomeAlready", { outcome: t(`outcome_${app.interview.outcome}`) })}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => outcome(app.id, "proceed")}>
                      {t("outcome_proceed")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => outcome(app.id, "request_info")}
                    >
                      {t("outcome_request_info")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => outcome(app.id, "waitlist")}>
                      {t("outcome_waitlist")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => outcome(app.id, "decline")}
                    >
                      {t("outcome_decline")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
