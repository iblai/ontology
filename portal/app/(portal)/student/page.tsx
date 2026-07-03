"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BookOpen, Lock, Megaphone, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { PlacementBadge } from "@/components/shared/status-badge";
import { advancePlacement, findStudent } from "@/lib/api";
import type { Subject } from "@/lib/types";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";

const SUBJECTS: Subject[] = ["math", "languageArts"];

export default function StudentDashboard() {
  const t = useTranslations("student");
  const user = useRequireRole(["student"]);
  const { data, reload } = useLoad(async () => {
    if (!user?.studentId) return undefined;
    return (await findStudent(user.studentId)) ?? undefined;
  }, [user]);

  if (!user || !data) return null;
  const { app, student } = data;
  const cfg = getSchoolConfig(app.schoolSlug);

  const advance = async (subject: Subject) => {
    await advancePlacement(student.id, subject);
    const next = student.placement[subject].status === "assigned" ? "started" : "completed";
    toast.success(next === "completed" ? t("testSubmitted") : t("testStarted"));
    await reload();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("welcome", { name: student.legalFirstName })}
        description={`${cfg?.name ?? app.schoolSlug} · ${
          student.gradeLevel === "K" ? t("kindergarten") : t("gradeN", { n: student.gradeLevel })
        } · ${app.programYear}`}
      />

      {/* Placement tests — PDF §10 student dashboard */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("placementTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {SUBJECTS.map((subject) => {
            const p = student.placement[subject];
            const label = subject === "math" ? t("math") : t("languageArts");
            return (
              <div key={subject} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{label}</p>
                  <PlacementBadge status={p.status} />
                </div>
                {p.status === "not_assigned" && (
                  <p className="mt-2 text-xs text-muted-foreground">{t("notAssignedHint")}</p>
                )}
                {(p.status === "assigned" || p.status === "started") && (
                  <Button size="sm" className="mt-2" onClick={() => advance(subject)}>
                    <Play className="size-3.5" />
                    {p.status === "assigned" ? t("startTest") : t("continueTest")}
                  </Button>
                )}
                {p.status === "completed" && (
                  <p className="mt-2 text-xs text-muted-foreground">{t("awaitingReview")}</p>
                )}
                {(p.status === "reviewed" || p.status === "confirmed") && p.finalCourse && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("placedIn", { course: p.finalCourse, start: p.finalStartPoint ?? "" })}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Courses */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("coursesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {student.courseEnrollments.length === 0 && (
            <EmptyState title={t("noCourses")} description={t("noCoursesHint")} />
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {student.courseEnrollments.map((c) => (
              <div
                key={c.courseId}
                className={`rounded-lg border p-4 ${c.active ? "" : "opacity-70"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <BookOpen className="size-5 text-primary" />
                  {c.active ? (
                    <Badge className="bg-emerald-50 text-emerald-700" variant="secondary">
                      {t("active")}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <Lock className="size-3" />
                      {t("availableOn", { date: fmtDate(c.startDate) })}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium">{c.courseName}</p>
                <p className="text-xs text-muted-foreground">
                  {t("startsOn", { date: fmtDate(c.startDate) })}
                </p>
                <Button
                  size="sm"
                  variant={c.active ? "default" : "outline"}
                  disabled={!c.active}
                  className="mt-3 w-full"
                  onClick={() => toast.info(t("openCourseStub"))}
                >
                  {t("openCourse")}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Announcements */}
      {cfg && cfg.announcements.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="size-4" />
              {t("announcementsTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {cfg.announcements.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
