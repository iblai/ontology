"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, CreditCard, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { FamilyApplicationView } from "@/lib/api";
import type { WizardForm } from "./wizard-state";
import type { SchoolConfig } from "@/lib/schools";
import { money, fmtDate } from "@/lib/format";

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-44 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{value}</span>
    </div>
  );
}

export function StepReview({
  form,
  cfg,
  draft,
  onEdit,
  onPay,
  paying,
}: {
  form: WizardForm;
  cfg: SchoolConfig;
  draft: FamilyApplicationView;
  onEdit: (step: number) => void;
  onPay: (card: { number: string; name: string }) => Promise<void>;
  paying: boolean;
}) {
  const t = useTranslations("apply");
  const [payOpen, setPayOpen] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [cardName, setCardName] = useState("");

  const feePaid = draft.fee.status === "paid" || draft.fee.status === "waived";
  const g1 = form.guardian1;

  const section = (titleKey: string, step: number, children: React.ReactNode) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t(titleKey)}</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => onEdit(step)}>
          <Pencil className="size-3.5" />
          {t("edit")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-1.5">{children}</CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {section(
        "guardian1Title",
        1,
        <>
          <Row label={t("fullName")} value={`${g1.firstName} ${g1.lastName}`} />
          <Row label={t("relationship")} value={g1.relationship} />
          <Row label={t("email")} value={g1.email} />
          <Row label={t("phone")} value={g1.phone} />
          <Row
            label={t("address")}
            value={`${g1.address.street}, ${g1.address.city}, ${g1.address.state} ${g1.address.zip}`}
          />
          {form.guardian2.firstName && (
            <Row
              label={t("guardian2Title")}
              value={`${form.guardian2.firstName} ${form.guardian2.lastName} (${form.guardian2.email})`}
            />
          )}
          {cfg.familyQuestions.map((q) =>
            form.familyAnswers[q.id] ? (
              <Row key={q.id} label={q.label} value={form.familyAnswers[q.id]} />
            ) : null,
          )}
        </>,
      )}

      {section(
        "studentsTitle",
        2,
        <div className="space-y-3">
          {form.students.map((s) => {
            const program = cfg.programs.find((p) => p.id === s.program);
            return (
              <div key={s.id} className="rounded-lg border p-3">
                <p className="text-sm font-medium">
                  {s.legalFirstName} {s.legalLastName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {s.gradeLevel === "K" ? t("kindergarten") : t("gradeN", { n: s.gradeLevel })}
                    {" · "}
                    {program?.label ?? s.program}
                    {s.individualCourse ? ` (${s.individualCourse})` : ""}
                  </span>
                </p>
                <Row label={t("dateOfBirth")} value={fmtDate(s.dateOfBirth)} />
                {s.email && <Row label={t("studentEmail")} value={s.email} />}
              </div>
            );
          })}
        </div>,
      )}

      {section(
        "agreementsTitle",
        3,
        <>
          <Row
            label={t("agreementsChecked")}
            value={`${form.acknowledgments.filter((a) => a.checked).length}/${form.acknowledgments.length}`}
          />
          <Row label={t("primarySignature")} value={form.sigs.primarySig} />
          {form.sigs.coSig && <Row label={t("coParentSignature")} value={form.sigs.coSig} />}
          {form.sigs.studentSig && (
            <Row label={t("studentSignature")} value={form.sigs.studentSig} />
          )}
          {cfg.requiresPhotoMediaRelease && (
            <Row label={t("photoMediaReleaseShort")} value={form.photoMediaRelease} />
          )}
        </>,
      )}

      {/* Fee panel — PDF §5.1: fee shown before submission, blocking. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("feeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {draft.fee.basis === "student"
                ? t("feePerStudent", {
                    amount: money(cfg.fee.amountCents),
                    n: form.students.length,
                  })
                : t("feePerFamily")}
            </span>
            <span className="text-lg font-semibold">{money(draft.fee.amountCents)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(`refundability_${draft.fee.refundability}`)}
          </p>
          <Separator />
          {feePaid ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="size-4" />
              {draft.fee.status === "waived"
                ? t("feeWaived")
                : t("feePaid", { date: fmtDate(draft.fee.paidAt) })}
            </p>
          ) : (
            <Button onClick={() => setPayOpen(true)}>
              <CreditCard className="size-4" />
              {t("payFee", { amount: money(draft.fee.amountCents) })}
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("paymentTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              {t("mockPaymentNotice")}
            </p>
            <div className="space-y-1.5">
              <Label>{t("cardName")}</Label>
              <Input value={cardName} onChange={(e) => setCardName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("cardNumber")}</Label>
              <Input
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                placeholder="4242 4242 4242 4242"
                inputMode="numeric"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("cardExpiry")}</Label>
                <Input placeholder="MM/YY" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("cardCvc")}</Label>
                <Input placeholder="CVC" inputMode="numeric" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={paying || !cardNumber.trim() || !cardName.trim()}
              onClick={async () => {
                await onPay({ number: cardNumber, name: cardName });
                setPayOpen(false);
              }}
            >
              {t("payFee", { amount: money(draft.fee.amountCents) })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
