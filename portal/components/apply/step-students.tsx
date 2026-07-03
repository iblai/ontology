"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QuestionField } from "./question-field";
import { blankWizardStudent, type WizardForm } from "./wizard-state";
import type { StudentApplication } from "@/lib/types";
import { GRADE_LEVELS, showsStudentResponses, type SchoolConfig } from "@/lib/schools";
import { ageFromDob } from "@/lib/format";

// ponytail: static demo catalog for AFA "Individual Course" selection.
const INDIVIDUAL_COURSES = [
  "Algebra I",
  "Geometry",
  "Biology",
  "US History",
  "Latin I",
  "Literature & Composition",
];

export function StepStudents({
  form,
  setForm,
  cfg,
  errors,
}: {
  form: WizardForm;
  setForm: (f: WizardForm) => void;
  cfg: SchoolConfig;
  errors: Record<string, string>;
}) {
  const t = useTranslations("apply");
  const te = useTranslations("wizardErrors");

  const setStudent = (i: number, patch: Partial<StudentApplication>) => {
    const students = form.students.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setForm({ ...form, students });
  };

  const err = (i: number, field: string) =>
    errors[`s${i}.${field}`] ? te(errors[`s${i}.${field}`]) : undefined;

  return (
    <div className="space-y-4">
      {form.students.map((s, i) => {
        const age = ageFromDob(s.dateOfBirth);
        const program = cfg.programs.find((p) => p.id === s.program);
        const showResponses = s.gradeLevel && showsStudentResponses(s.gradeLevel);
        return (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {s.legalFirstName
                  ? `${s.legalFirstName} ${s.legalLastName}`
                  : t("studentN", { n: i + 1 })}
              </CardTitle>
              {form.students.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    setForm({
                      ...form,
                      students: form.students.filter((_, idx) => idx !== i),
                    })
                  }
                >
                  <Trash2 className="size-4" />
                  {t("removeStudent")}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>
                    {t("legalFirstName")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={s.legalFirstName}
                    onChange={(e) => setStudent(i, { legalFirstName: e.target.value })}
                  />
                  {err(i, "legalFirstName") && (
                    <p className="text-xs text-destructive">{err(i, "legalFirstName")}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>
                    {t("legalLastName")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={s.legalLastName}
                    onChange={(e) => setStudent(i, { legalLastName: e.target.value })}
                  />
                  {err(i, "legalLastName") && (
                    <p className="text-xs text-destructive">{err(i, "legalLastName")}</p>
                  )}
                </div>
                {cfg.model === "network" && (
                  <div className="space-y-1.5">
                    <Label>{t("preferredName")}</Label>
                    <Input
                      value={s.preferredName ?? ""}
                      onChange={(e) => setStudent(i, { preferredName: e.target.value })}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>
                    {t("dateOfBirth")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="date"
                    value={s.dateOfBirth}
                    onChange={(e) => setStudent(i, { dateOfBirth: e.target.value })}
                  />
                  {age !== null && (
                    <p className="text-xs text-muted-foreground">{t("age", { age })}</p>
                  )}
                  {err(i, "dateOfBirth") && (
                    <p className="text-xs text-destructive">{err(i, "dateOfBirth")}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>
                    {t("gender")} <span className="text-destructive">*</span>
                  </Label>
                  <Select value={s.gender} onValueChange={(v) => setStudent(i, { gender: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Female">{t("genderFemale")}</SelectItem>
                      <SelectItem value="Male">{t("genderMale")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {err(i, "gender") && (
                    <p className="text-xs text-destructive">{err(i, "gender")}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>
                    {t("gradeLevel", { year: cfg.programYear })}{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={s.gradeLevel}
                    onValueChange={(v) => setStudent(i, { gradeLevel: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADE_LEVELS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g === "K" ? t("kindergarten") : t("gradeN", { n: g })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {err(i, "gradeLevel") && (
                    <p className="text-xs text-destructive">{err(i, "gradeLevel")}</p>
                  )}
                </div>
                {cfg.model === "afa" && (
                  <div className="space-y-1.5">
                    <Label>
                      {t("studentEmail")}
                      {showResponses && <span className="ml-0.5 text-destructive">*</span>}
                    </Label>
                    <Input
                      type="email"
                      value={s.email ?? ""}
                      onChange={(e) => setStudent(i, { email: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">{t("studentEmailHint")}</p>
                    {err(i, "email") && (
                      <p className="text-xs text-destructive">{err(i, "email")}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>
                  {t("programSelection")} <span className="text-destructive">*</span>
                </Label>
                <Select value={s.program} onValueChange={(v) => setStudent(i, { program: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cfg.programs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                        {p.description ? ` — ${p.description}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {err(i, "program") && (
                  <p className="text-xs text-destructive">{err(i, "program")}</p>
                )}
              </div>

              {program?.requiresCourseSelection && (
                <div className="space-y-1.5">
                  <Label>
                    {t("selectCourse")} <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={s.individualCourse ?? ""}
                    onValueChange={(v) => setStudent(i, { individualCourse: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INDIVIDUAL_COURSES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {err(i, "individualCourse") && (
                    <p className="text-xs text-destructive">{err(i, "individualCourse")}</p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>{t("supportInfo")}</Label>
                <Textarea
                  rows={2}
                  value={s.supportInfo}
                  onChange={(e) => setStudent(i, { supportInfo: e.target.value })}
                />
              </div>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">{t("academicBackgroundTitle")}</h3>
                {cfg.academicBackgroundQuestions.map((q) => (
                  <QuestionField
                    key={q.id}
                    question={q}
                    value={s.academicBackground[q.id] ?? ""}
                    onChange={(v) =>
                      setStudent(i, {
                        academicBackground: { ...s.academicBackground, [q.id]: v },
                      })
                    }
                  />
                ))}
              </section>

              {showResponses && (
                <section className="space-y-3 rounded-lg border bg-muted/30 p-4">
                  <h3 className="text-sm font-semibold">{t("studentResponsesTitle")}</h3>
                  <p className="text-xs text-muted-foreground">{t("studentResponsesHint")}</p>
                  {cfg.studentResponseQuestions.map((q) => (
                    <QuestionField
                      key={q.id}
                      question={q}
                      value={s.studentResponses?.[q.id] ?? ""}
                      onChange={(v) =>
                        setStudent(i, {
                          studentResponses: { ...s.studentResponses, [q.id]: v },
                        })
                      }
                    />
                  ))}
                </section>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Button
        variant="outline"
        onClick={() => setForm({ ...form, students: [...form.students, blankWizardStudent()] })}
      >
        <Plus className="size-4" />
        {t("addStudent")}
      </Button>
    </div>
  );
}
