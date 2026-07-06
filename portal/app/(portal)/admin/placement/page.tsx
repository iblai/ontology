"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
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
import { PlacementBadge } from "@/components/shared/status-badge";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { assignPlacement, confirmPlacement, listApplications, reviewPlacement } from "@/lib/api";
import type { Application, StudentApplication, Subject } from "@/lib/types";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";

interface Row {
  app: Application;
  student: StudentApplication;
  schoolName: string;
}

const ENROLLING = ["accepted", "enrollment_in_progress", "enrolled"];
const SUBJECTS: Subject[] = ["math", "languageArts"];

// Placement testing management. PDF §9.1 — assign (bulk), review, override, confirm.
export default function PlacementPage() {
  const t = useTranslations("placement");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin"]);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [review, setReview] = useState<{ row: Row; subject: Subject } | null>(null);
  const [course, setCourse] = useState("");
  const [startPoint, setStartPoint] = useState("");

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

  const selectedIds = Object.keys(selection).filter((k) => selection[k]);

  const bulkAssign = async () => {
    await assignPlacement(selectedIds, SUBJECTS);
    toast.success(t("assigned", { n: selectedIds.length }));
    setSelection({});
    await reload();
  };

  const openReview = (row: Row, subject: Subject) => {
    const p = row.student.placement[subject];
    setCourse(p.finalCourse ?? p.recommendedCourse ?? "");
    setStartPoint(p.finalStartPoint ?? p.recommendedStartPoint ?? "");
    setReview({ row, subject });
  };

  const subjectCell = (row: Row, subject: Subject) => {
    const p = row.student.placement[subject];
    return (
      <div className="flex flex-col items-start gap-1">
        <PlacementBadge status={p.status} />
        {p.status === "not_assigned" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={async () => {
              await assignPlacement([row.student.id], [subject]);
              toast.success(t("assigned", { n: 1 }));
              await reload();
            }}
          >
            {t("assign")}
          </Button>
        )}
        {["completed", "reviewed", "confirmed"].includes(p.status) && (
          <button
            type="button"
            className="text-left text-xs text-primary hover:underline"
            onClick={() => openReview(row, subject)}
          >
            {p.status === "confirmed"
              ? `${p.finalCourse} @ ${p.finalStartPoint}`
              : `${p.recommendedCourse} @ ${p.recommendedStartPoint}`}
          </button>
        )}
      </div>
    );
  };

  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
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
    {
      id: "school",
      accessorFn: (r) => r.schoolName,
      header: sortableHeader(t("colSchool")),
    },
    {
      id: "grade",
      accessorFn: (r) => r.student.gradeLevel,
      header: sortableHeader(t("colGrade")),
    },
    {
      id: "math",
      header: t("colMath"),
      cell: ({ row }) => subjectCell(row.original, "math"),
    },
    {
      id: "languageArts",
      header: t("colLanguageArts"),
      cell: ({ row }) => subjectCell(row.original, "languageArts"),
    },
  ];

  const reviewP = review ? review.row.student.placement[review.subject] : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.student.id}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        searchPlaceholder={t("searchPlaceholder")}
        toolbar={
          <Button size="sm" disabled={selectedIds.length === 0} onClick={bulkAssign}>
            {t("bulkAssign", { n: selectedIds.length })}
          </Button>
        }
      />

      <Dialog open={Boolean(review)} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {review &&
                t("reviewTitle", {
                  student: review.row.student.legalFirstName,
                  subject: review.subject === "math" ? t("colMath") : t("colLanguageArts"),
                })}
            </DialogTitle>
          </DialogHeader>
          {review && reviewP && (
            <div className="space-y-3">
              <p className="rounded-md bg-muted/40 p-3 text-sm">
                {t("recommendation")}:{" "}
                <span className="font-medium">
                  {reviewP.recommendedCourse} — {reviewP.recommendedStartPoint}
                </span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t("finalCourse")}</Label>
                  <Input value={course} onChange={(e) => setCourse(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("startPoint")}</Label>
                  <Input value={startPoint} onChange={(e) => setStartPoint(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t("overrideHint")}</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            {review && reviewP?.status === "completed" && (
              <Button
                variant="outline"
                onClick={async () => {
                  await reviewPlacement(review.row.student.id, review.subject);
                  toast.success(t("markedReviewed"));
                  setReview(null);
                  await reload();
                }}
              >
                {t("markReviewed")}
              </Button>
            )}
            {review && reviewP?.status !== "confirmed" && (
              <Button
                disabled={!course.trim() || !startPoint.trim()}
                onClick={async () => {
                  await confirmPlacement(review.row.student.id, review.subject, {
                    course: course.trim(),
                    start: startPoint.trim(),
                  });
                  toast.success(t("confirmed"));
                  setReview(null);
                  await reload();
                }}
              >
                {t("confirmPlacement")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
