"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { assignCourses, listApplications, removeCourse } from "@/lib/api";
import type { Application, StudentApplication } from "@/lib/types";
import { catalogForGrade } from "@/lib/courses";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";

interface Row {
  app: Application;
  student: StudentApplication;
  schoolName: string;
}

const ENROLLING = ["accepted", "enrollment_in_progress", "enrolled"];

// Course enrollment management. PDF §9.2 — assign based on placement, start dates, changes.
export default function CoursesPage() {
  const t = useTranslations("courses");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin"]);
  const [assignRow, setAssignRow] = useState<Row | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [startDate, setStartDate] = useState("2026-08-20");

  const { data: apps, reload } = useLoad(async () => {
    if (!user) return undefined;
    return listApplications();
  }, [user]);

  const rows = useMemo<Row[]>(() => {
    if (!apps) return [];
    return apps.flatMap((app) =>
      app.students
        .filter((s) => ENROLLING.includes(s.status))
        .map((student) => ({
          app,
          student,
          schoolName: getSchoolConfig(app.schoolSlug)?.shortName ?? app.schoolSlug,
        })),
    );
  }, [apps]);

  if (!user || !apps) return null;

  const openAssign = (row: Row) => {
    // Preselect placement-confirmed courses. PDF §9.2.
    const suggested = [
      row.student.placement.math.finalCourse,
      row.student.placement.languageArts.finalCourse,
    ].filter(Boolean) as string[];
    const initial: Record<string, boolean> = {};
    for (const c of catalogForGrade(row.student.gradeLevel)) {
      if (suggested.includes(c.courseName)) initial[c.courseId] = true;
    }
    setPicked(initial);
    setAssignRow(row);
  };

  const doAssign = async () => {
    if (!assignRow) return;
    const catalog = catalogForGrade(assignRow.student.gradeLevel);
    const chosen = catalog.filter((c) => picked[c.courseId]);
    if (chosen.length === 0) return;
    await assignCourses(
      assignRow.student.id,
      chosen.map((c) => ({ ...c, startDate })),
    );
    toast.success(t("assignedToast", { n: chosen.length }));
    setAssignRow(null);
    await reload();
  };

  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: "student",
      accessorFn: (r) => `${r.student.legalFirstName} ${r.student.legalLastName}`,
      header: sortableHeader(t("colStudent")),
      cell: ({ row }) => (
        <span className="font-medium">
          {row.original.student.legalFirstName} {row.original.student.legalLastName}
        </span>
      ),
    },
    { id: "school", accessorFn: (r) => r.schoolName, header: sortableHeader(t("colSchool")) },
    { id: "grade", accessorFn: (r) => r.student.gradeLevel, header: sortableHeader(t("colGrade")) },
    {
      id: "placement",
      header: t("colPlacement"),
      cell: ({ row }) => {
        const s = row.original.student;
        const parts = [s.placement.math.finalCourse, s.placement.languageArts.finalCourse].filter(
          Boolean,
        );
        return parts.length ? (
          <span className="text-xs">{parts.join(", ")}</span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("noPlacementYet")}</span>
        );
      },
    },
    {
      id: "courses",
      header: t("colCourses"),
      cell: ({ row }) => (
        <span className="flex max-w-md flex-wrap gap-1">
          {row.original.student.courseEnrollments.map((c) => (
            <Badge key={c.courseId} variant="secondary" className="gap-1">
              {c.courseName}
              <span className="text-[10px] text-muted-foreground">{fmtDate(c.startDate)}</span>
              <button
                type="button"
                onClick={async (e) => {
                  e.stopPropagation();
                  await removeCourse(row.original.student.id, c.courseId);
                  toast.success(t("removedToast"));
                  await reload();
                }}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            openAssign(row.original);
          }}
        >
          {t("assignCourses")}
        </Button>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DataTable columns={columns} data={rows} searchPlaceholder={t("searchPlaceholder")} />

      <Dialog open={Boolean(assignRow)} onOpenChange={(o) => !o && setAssignRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {assignRow &&
                t("assignTitle", {
                  student: `${assignRow.student.legalFirstName} ${assignRow.student.legalLastName}`,
                  grade: assignRow.student.gradeLevel,
                })}
            </DialogTitle>
          </DialogHeader>
          {assignRow && (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                {catalogForGrade(assignRow.student.gradeLevel).map((c) => {
                  const already = assignRow.student.courseEnrollments.some(
                    (e) => e.courseId === c.courseId,
                  );
                  return (
                    <label
                      key={c.courseId}
                      className={`flex items-center gap-2 text-sm ${already ? "opacity-50" : ""}`}
                    >
                      <Checkbox
                        disabled={already}
                        checked={already || Boolean(picked[c.courseId])}
                        onCheckedChange={(v) =>
                          setPicked((p) => ({ ...p, [c.courseId]: v === true }))
                        }
                      />
                      {c.courseName}
                      {already && (
                        <span className="text-xs text-muted-foreground">
                          {t("alreadyEnrolled")}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                <Label>{t("startDate")}</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("startDateHint")}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={doAssign}>{t("assignCourses")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
