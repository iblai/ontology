"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { QuestionField } from "./question-field";
import type { WizardForm } from "./wizard-state";
import type { Guardian } from "@/lib/types";
import type { SchoolConfig } from "@/lib/schools";

function Field({
  label,
  value,
  onChange,
  error,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  required?: boolean;
  type?: string;
}) {
  const te = useTranslations("wizardErrors");
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <p className="text-xs text-destructive">{te(error)}</p>}
    </div>
  );
}

function GuardianFields({
  guardian,
  onChange,
  errors,
  prefix,
  required,
}: {
  guardian: Guardian;
  onChange: (g: Guardian) => void;
  errors: Record<string, string>;
  prefix: string;
  required?: boolean;
}) {
  const t = useTranslations("apply");
  const set = (patch: Partial<Guardian>) => onChange({ ...guardian, ...patch });
  const setAddr = (patch: Partial<Guardian["address"]>) =>
    onChange({ ...guardian, address: { ...guardian.address, ...patch } });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label={t("firstName")}
        value={guardian.firstName}
        onChange={(v) => set({ firstName: v })}
        error={errors[`${prefix}.firstName`]}
        required={required}
      />
      <Field
        label={t("lastName")}
        value={guardian.lastName}
        onChange={(v) => set({ lastName: v })}
        error={errors[`${prefix}.lastName`]}
        required={required}
      />
      <Field
        label={t("relationship")}
        value={guardian.relationship}
        onChange={(v) => set({ relationship: v })}
        error={errors[`${prefix}.relationship`]}
        required={required}
      />
      <Field
        label={t("email")}
        value={guardian.email}
        onChange={(v) => set({ email: v })}
        error={errors[`${prefix}.email`]}
        required={required}
        type="email"
      />
      <Field
        label={t("phone")}
        value={guardian.phone}
        onChange={(v) => set({ phone: v })}
        error={errors[`${prefix}.phone`]}
        required={required}
        type="tel"
      />
      <Field
        label={t("secondaryPhone")}
        value={guardian.secondaryPhone ?? ""}
        onChange={(v) => set({ secondaryPhone: v })}
        type="tel"
      />
      <div className="sm:col-span-2">
        <Field
          label={t("street")}
          value={guardian.address.street}
          onChange={(v) => setAddr({ street: v })}
          error={errors[`${prefix}.street`]}
          required={required}
        />
      </div>
      <Field
        label={t("city")}
        value={guardian.address.city}
        onChange={(v) => setAddr({ city: v })}
        error={errors[`${prefix}.city`]}
        required={required}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t("state")}
          value={guardian.address.state}
          onChange={(v) => setAddr({ state: v })}
          error={errors[`${prefix}.state`]}
          required={required}
        />
        <Field
          label={t("zip")}
          value={guardian.address.zip}
          onChange={(v) => setAddr({ zip: v })}
          error={errors[`${prefix}.zip`]}
          required={required}
        />
      </div>
    </div>
  );
}

export function StepFamily({
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

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-base font-semibold">{t("guardian1Title")}</h2>
        <GuardianFields
          guardian={form.guardian1}
          onChange={(g) => setForm({ ...form, guardian1: g })}
          errors={errors}
          prefix="g1"
          required
        />
      </section>

      <Accordion
        type="single"
        collapsible
        defaultValue={form.guardian2.firstName ? "g2" : undefined}
      >
        <AccordionItem value="g2" className="rounded-lg border px-4">
          <AccordionTrigger className="text-sm font-semibold">
            {t("guardian2Title")}
          </AccordionTrigger>
          <AccordionContent>
            <GuardianFields
              guardian={form.guardian2}
              onChange={(g) => setForm({ ...form, guardian2: g })}
              errors={errors}
              prefix="g2"
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {cfg.familyQuestions.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-base font-semibold">{t("familyBackgroundTitle")}</h2>
          {cfg.familyQuestions.map((q) => (
            <QuestionField
              key={q.id}
              question={q}
              value={form.familyAnswers[q.id] ?? ""}
              onChange={(v) =>
                setForm({
                  ...form,
                  familyAnswers: { ...form.familyAnswers, [q.id]: v },
                })
              }
              error={errors[`fq.${q.id}`] ? te(errors[`fq.${q.id}`]) : undefined}
            />
          ))}
        </section>
      )}
    </div>
  );
}
