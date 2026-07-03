"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Circle, ExternalLink, PenLine } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { PlacementBadge, StatusBadge } from "@/components/shared/status-badge";
import { FileUploadStub } from "@/components/shared/file-upload-stub";
import { SignatureBlock } from "@/components/shared/signature-block";
import { getApplicationForFamily, payFee, signWaiver, uploadDocument } from "@/lib/api";
import type { Application } from "@/lib/types";
import { submitReadiness } from "@/lib/status";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate, fmtDateTime, money } from "@/lib/format";

export function ParentApplicationDetail({ id }: { id: string }) {
  const t = useTranslations("parentDetail");
  const user = useRequireRole(["parent"]);
  const router = useRouter();
  const { data: app, reload } = useLoad(async () => {
    if (!user) return undefined;
    return getApplicationForFamily(id);
  }, [user, id]);

  const [signAck, setSignAck] = useState<string | null>(null);
  const [sigName, setSigName] = useState("");
  const [sigText, setSigText] = useState("");

  if (!user || !app) return null;
  if (app.parentEmail !== user.email!.toLowerCase()) {
    router.replace("/parent");
    return null;
  }

  const cfg = getSchoolConfig(app.schoolSlug);
  const editable = app.status === "draft" || app.status === "incomplete";
  // Readiness only reads acknowledgments/signatures/students/fee — safe on the family view.
  const readiness = submitReadiness(app as unknown as Application);
  const unchecked = app.acknowledgments.filter((a) => !a.checked);

  const doSign = async () => {
    if (!signAck) return;
    await signWaiver(app.id, signAck, {
      role: "primary_parent",
      signerName: sigName,
      signature: sigText,
    });
    setSignAck(null);
    setSigName("");
    setSigText("");
    toast.success(t("signed"));
    await reload();
  };

  const doPayFee = async () => {
    await payFee(app.id);
    toast.success(t("feePaidToast"));
    await reload();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {cfg?.name ?? app.schoolSlug}
            <StatusBadge status={app.status} />
          </span>
        }
        description={`${app.id} · ${app.programYear}`}
        actions={
          editable ? (
            <Button asChild size="sm">
              <Link href={`/apply/${app.schoolSlug}?draft=${app.id}`}>{t("continueEditing")}</Link>
            </Button>
          ) : undefined
        }
      />

      {!readiness.ready && ["draft", "incomplete", "submitted"].includes(app.status) && (
        <Alert className="mb-4 border-amber-200 bg-amber-50 text-amber-900">
          <AlertTitle>{t("missingItems")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {readiness.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {app.decisionNotices.map((n, i) => (
        <Alert key={i} className="mb-4 border-blue-200 bg-blue-50 text-blue-900">
          <AlertTitle>
            {t("decisionNotice")} · {fmtDate(n.sentAt)}
          </AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{n.body}</AlertDescription>
        </Alert>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Fee */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("feeTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span>{money(app.fee.amountCents)}</span>
              {app.fee.status === "unpaid" ? (
                <Button size="sm" onClick={doPayFee}>
                  {t("payNow")}
                </Button>
              ) : (
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="size-4" />
                  {app.fee.status === "waived"
                    ? t("waived")
                    : t("paidOn", { date: fmtDate(app.fee.paidAt) })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("documentsTitle")}</CardTitle>
            <FileUploadStub
              onUpload={async (meta) => {
                await uploadDocument(app.id, meta);
                toast.success(t("uploaded"));
                await reload();
              }}
            />
          </CardHeader>
          <CardContent>
            {app.documents.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("noDocuments")}</p>
            )}
            <ul className="space-y-1 text-sm">
              {app.documents.map((d) => (
                <li key={d.id} className="flex justify-between gap-2">
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtDate(d.uploadedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Agreements */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("agreementsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {app.acknowledgments.map((a) => (
            <div key={a.id} className="flex items-start gap-2 text-sm">
              {a.checked ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                {a.label}
                {a.documentUrl && (
                  <a
                    href={a.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </span>
              {!a.checked && (
                <Button variant="outline" size="sm" onClick={() => setSignAck(a.id)}>
                  <PenLine className="size-3.5" />
                  {t("sign")}
                </Button>
              )}
            </div>
          ))}
          {unchecked.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("allSigned")}</p>
          )}
          {cfg && (
            <p className="pt-1 text-xs text-muted-foreground">
              {t("handbook")}:{" "}
              <a
                href={cfg.handbook.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {cfg.handbook.version}
              </a>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Students */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("studentsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple">
            {app.students.map((s) => (
              <AccordionItem key={s.id} value={s.id}>
                <AccordionTrigger className="text-sm">
                  <span className="flex items-center gap-2">
                    {s.legalFirstName} {s.legalLastName}
                    <StatusBadge status={s.status} />
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    {s.gradeLevel === "K" ? t("kindergarten") : t("gradeN", { n: s.gradeLevel })}
                    {" · "}
                    {cfg?.programs.find((p) => p.id === s.program)?.label ?? s.program}
                    {s.individualCourse ? ` (${s.individualCourse})` : ""}
                  </p>
                  {["enrollment_in_progress", "enrolled"].includes(s.status) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">{t("math")}</span>
                      <PlacementBadge status={s.placement.math.status} />
                      <span className="text-xs text-muted-foreground">{t("languageArts")}</span>
                      <PlacementBadge status={s.placement.languageArts.status} />
                    </div>
                  )}
                  {s.courseEnrollments.length > 0 && (
                    <ul className="space-y-1">
                      {s.courseEnrollments.map((c) => (
                        <li key={c.courseId} className="flex justify-between">
                          <span>{c.courseName}</span>
                          <span className="text-xs text-muted-foreground">
                            {c.active ? t("active") : t("startsOn", { date: fmtDate(c.startDate) })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* History (family-safe) */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">{t("historyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {[...app.history].reverse().map((h, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <StatusBadge status={h.to} />
                <span className="text-xs text-muted-foreground">{fmtDateTime(h.at)}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Sign dialog */}
      <Dialog open={Boolean(signAck)} onOpenChange={(o) => !o && setSignAck(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("signDialogTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {app.acknowledgments.find((a) => a.id === signAck)?.label}
          </p>
          <SignatureBlock
            label={t("signAs", { name: user.name })}
            name={sigName}
            signature={sigText}
            onNameChange={setSigName}
            onSignatureChange={setSigText}
          />
          <DialogFooter>
            <Button disabled={!sigName.trim() || !sigText.trim()} onClick={doSign}>
              {t("sign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
