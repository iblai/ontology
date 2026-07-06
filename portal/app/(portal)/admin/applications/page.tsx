"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { CreditCard, FileWarning, PenLine } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { DataTable, sortableHeader } from "@/components/shared/data-table";
import { listApplications } from "@/lib/api";
import type { Application, ApplicationStatus, StudentApplication } from "@/lib/types";
import { getSchoolConfig, listSchoolConfigs } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";

interface Row {
  app: Application;
  student: StudentApplication;
  parentName: string;
  schoolName: string;
  programLabel: string;
}

const ALL_STATUSES: ApplicationStatus[] = [
  "draft",
  "submitted",
  "incomplete",
  "under_review",
  "interview_required",
  "accepted",
  "declined",
  "waitlisted",
  "enrollment_in_progress",
  "enrolled",
  "withdrawn",
];

export default function AdminApplicationsPage() {
  const t = useTranslations("adminApps");
  const ts = useTranslations("status");
  const tc = useTranslations("common");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin"]);
  const router = useRouter();
  const [status, setStatus] = useState<string>("all");
  const [school, setSchool] = useState<string>("all");

  // Pre-filter from dashboard links (?status=...).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s) setStatus(s);
  }, []);

  const { data: apps } = useLoad(async () => {
    if (!user) return undefined;
    return listApplications();
  }, [user]);

  const rows = useMemo<Row[]>(() => {
    if (!apps) return [];
    return apps.flatMap((app) => {
      const cfg = getSchoolConfig(app.schoolSlug);
      const parent = app.guardians[0];
      return app.students.map((student) => ({
        app,
        student,
        parentName: parent ? `${parent.firstName} ${parent.lastName}` : app.parentEmail,
        schoolName: cfg?.shortName ?? app.schoolSlug,
        programLabel: cfg?.programs.find((p) => p.id === student.program)?.label ?? student.program,
      }));
    });
  }, [apps]);

  const filtered = rows.filter(
    (r) =>
      (status === "all" || r.student.status === status) &&
      (school === "all" || r.app.schoolSlug === school),
  );

  const isCentral = user?.role === "central_admin";

  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: "id",
      accessorFn: (r) => r.app.id,
      header: sortableHeader(t("colId")),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.app.id}</span>,
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
      id: "grade",
      accessorFn: (r) => r.student.gradeLevel,
      header: sortableHeader(t("colGrade")),
    },
    {
      id: "parent",
      accessorFn: (r) => r.parentName,
      header: sortableHeader(t("colParent")),
    },
    ...(isCentral
      ? [
          {
            id: "school",
            accessorFn: (r: Row) => r.schoolName,
            header: sortableHeader(t("colSchool")),
          } as ColumnDef<Row, unknown>,
        ]
      : []),
    {
      id: "program",
      accessorFn: (r) => r.programLabel,
      header: t("colProgram"),
    },
    {
      id: "submitted",
      accessorFn: (r) => r.app.submittedAt ?? "",
      header: sortableHeader(t("colSubmitted")),
      cell: ({ row }) => fmtDate(row.original.app.submittedAt),
    },
    {
      id: "missing",
      header: t("colMissing"),
      cell: ({ row }) => {
        const app = row.original.app;
        const icons = [];
        if (app.fee.status === "unpaid")
          icons.push(
            <CreditCard key="fee" className="size-4 text-amber-600" aria-label={t("missingFee")} />,
          );
        if (app.acknowledgments.some((a) => !a.checked))
          icons.push(
            <PenLine
              key="ack"
              className="size-4 text-amber-600"
              aria-label={t("missingWaivers")}
            />,
          );
        if (app.documents.length === 0)
          icons.push(
            <FileWarning
              key="doc"
              className="size-4 text-muted-foreground"
              aria-label={t("missingDocs")}
            />,
          );
        return (
          <span className="flex gap-1.5" title={t("missingHint")}>
            {icons}
          </span>
        );
      },
    },
    {
      id: "status",
      accessorFn: (r) => r.student.status,
      header: sortableHeader(t("colStatus")),
      cell: ({ row }) => <StatusBadge status={row.original.student.status} />,
    },
  ];

  if (!user) return null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder={t("searchPlaceholder")}
        onRowClick={(r) => router.push(`/admin/applications/${r.app.id}`)}
        toolbar={
          <>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {tc("all")} — {t("colStatus")}
                </SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ts(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isCentral && (
              <Select value={school} onValueChange={setSchool}>
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {tc("all")} — {t("colSchool")}
                  </SelectItem>
                  {listSchoolConfigs().map((s) => (
                    <SelectItem key={s.slug} value={s.slug}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        }
      />
    </div>
  );
}
