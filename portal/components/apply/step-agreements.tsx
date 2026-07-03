"use client";

import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SignatureBlock } from "@/components/shared/signature-block";
import type { WizardForm } from "./wizard-state";
import { showsStudentResponses, type SchoolConfig } from "@/lib/schools";
import type { MedicalRelease } from "@/lib/types";

export function StepAgreements({
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

  const setAck = (id: string, checked: boolean) =>
    setForm({
      ...form,
      acknowledgments: form.acknowledgments.map((a) => (a.id === id ? { ...a, checked } : a)),
    });

  const setMed = (patch: Partial<MedicalRelease>) =>
    setForm({ ...form, medicalRelease: { ...form.medicalRelease, ...patch } });

  const setSig = (patch: Partial<WizardForm["sigs"]>) =>
    setForm({ ...form, sigs: { ...form.sigs, ...patch } });

  const hasG2 = Boolean(form.guardian2.firstName || form.guardian2.email);
  const hasOlderStudent = form.students.some(
    (s) => s.gradeLevel && showsStudentResponses(s.gradeLevel),
  );

  const medField = (label: string, key: keyof MedicalRelease, type = "text", required = false) => (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <Input
        type={type}
        value={String(form.medicalRelease[key] ?? "")}
        onChange={(e) => setMed({ [key]: e.target.value } as Partial<MedicalRelease>)}
      />
      {errors[`med.${key}`] && (
        <p className="text-xs text-destructive">{te(errors[`med.${key}`])}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("agreementsTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("agreementsHint")}</p>
        {form.acknowledgments.map((ack) => (
          <label key={ack.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm">
            <Checkbox
              checked={ack.checked}
              onCheckedChange={(v) => setAck(ack.id, v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              {ack.label}
              {ack.documentUrl && (
                <a
                  href={ack.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t("viewDocument")}
                  <ExternalLink className="size-3" />
                </a>
              )}
              {errors[`ack.${ack.id}`] && (
                <span className="block text-xs text-destructive">
                  {te(errors[`ack.${ack.id}`])}
                </span>
              )}
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          {t("handbookVersion", { version: cfg.handbook.version })}{" "}
          <a
            href={cfg.handbook.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {t("viewHandbook")}
          </a>
        </p>
      </section>

      {cfg.requiresPhotoMediaRelease && (
        <section className="space-y-2 rounded-lg border p-4">
          <Label>
            {t("photoMediaRelease")} <span className="text-destructive">*</span>
          </Label>
          <RadioGroup
            value={form.photoMediaRelease}
            onValueChange={(v) => setForm({ ...form, photoMediaRelease: v as "Yes" | "No" })}
            className="flex gap-4 pt-1"
          >
            {(["Yes", "No"] as const).map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <RadioGroupItem value={o} />
                {o === "Yes" ? t("yes") : t("no")}
              </label>
            ))}
          </RadioGroup>
          {errors["photoMediaRelease"] && (
            <p className="text-xs text-destructive">{te(errors["photoMediaRelease"])}</p>
          )}
        </section>
      )}

      {cfg.requiresMedicalRelease && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t("medicalReleaseTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("medicalReleaseHint")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {medField(t("emergencyContactName"), "emergencyContactName", "text", true)}
            {medField(t("emergencyContactPhone"), "emergencyContactPhone", "tel", true)}
            {medField(
              t("emergencyContactRelationship"),
              "emergencyContactRelationship",
              "text",
              true,
            )}
            {medField(t("physician"), "physician")}
            {medField(t("insuranceProvider"), "insuranceProvider")}
            {medField(t("policyNumber"), "policyNumber")}
            {medField(t("effectiveFrom"), "effectiveFrom", "date", true)}
            {medField(t("effectiveTo"), "effectiveTo", "date", true)}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.medicalRelease.treatmentAuthorized}
              onCheckedChange={(v) => setMed({ treatmentAuthorized: v === true })}
            />
            {t("treatmentAuthorized")}
          </label>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t("signaturesTitle")}</h2>
        <SignatureBlock
          label={t("primarySignature")}
          name={form.sigs.primaryName}
          signature={form.sigs.primarySig}
          onNameChange={(v) => setSig({ primaryName: v })}
          onSignatureChange={(v) => setSig({ primarySig: v })}
          error={errors["sig.primaryName"] || errors["sig.primarySig"] ? te("required") : undefined}
        />
        {cfg.signatures.coParent && hasG2 && (
          <SignatureBlock
            label={t("coParentSignature")}
            name={form.sigs.coName}
            signature={form.sigs.coSig}
            onNameChange={(v) => setSig({ coName: v })}
            onSignatureChange={(v) => setSig({ coSig: v })}
            error={errors["sig.coName"] || errors["sig.coSig"] ? te("required") : undefined}
          />
        )}
        {cfg.signatures.student && hasOlderStudent && (
          <SignatureBlock
            label={t("studentSignature")}
            name={form.sigs.studentName}
            signature={form.sigs.studentSig}
            onNameChange={(v) => setSig({ studentName: v })}
            onSignatureChange={(v) => setSig({ studentSig: v })}
            error={
              errors["sig.studentName"] || errors["sig.studentSig"] ? te("required") : undefined
            }
          />
        )}
      </section>
    </div>
  );
}
