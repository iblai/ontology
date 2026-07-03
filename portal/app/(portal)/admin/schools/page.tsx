"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { listSchoolConfigs } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { fmtDate, money } from "@/lib/format";

// Central admin: per-school configuration overview. PDF §4.
// ponytail: read-only — schools are typed configs in lib/schools/*.ts; cloning a
// config file is how a new network school onboards until self-service is needed.
export default function SchoolsPage() {
  const t = useTranslations("schools");
  const user = useRequireRole(["central_admin"]);
  if (!user) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <div className="space-y-6">
        {listSchoolConfigs().map((cfg) => (
          <Card key={cfg.slug}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Image
                  src={cfg.logo}
                  alt={cfg.name}
                  width={160}
                  height={36}
                  className="h-9 w-auto object-contain"
                />
                <div>
                  <CardTitle className="text-base">{cfg.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {cfg.model === "afa" ? t("modelAfa") : t("modelNetwork")} · {cfg.programYear}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/apply/${cfg.slug}`} target="_blank">
                  {t("openApplication")}
                  <ExternalLink className="size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="mb-1 font-semibold">{t("programs")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {cfg.programs.map((p) => (
                    <Badge key={p.id} variant="secondary">
                      {p.label}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 font-semibold">{t("admissions")}</p>
                <p className="text-muted-foreground">
                  {cfg.interviewRequiredByDefault ? t("interviewRequired") : t("noInterview")}
                  {" · "}
                  {t("feeSummary", {
                    amount: money(cfg.fee.amountCents),
                    basis: cfg.fee.basis === "family" ? t("perFamily") : t("perStudent"),
                  })}
                </p>
                {cfg.reenrollmentWindow && (
                  <p className="text-xs text-muted-foreground">
                    {t("reenrollWindow", {
                      opens: fmtDate(cfg.reenrollmentWindow.opens),
                      deadline: fmtDate(cfg.reenrollmentWindow.deadline),
                    })}
                  </p>
                )}
              </div>
              <div>
                <p className="mb-1 font-semibold">{t("handbook")}</p>
                <a
                  href={cfg.handbook.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {cfg.handbook.version}
                </a>
              </div>
              <div>
                <p className="mb-1 font-semibold">{t("requirements")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {cfg.requiresMedicalRelease && (
                    <Badge variant="secondary">{t("medicalRelease")}</Badge>
                  )}
                  {cfg.requiresPhotoMediaRelease && (
                    <Badge variant="secondary">{t("photoRelease")}</Badge>
                  )}
                  {cfg.signatures.coParent && <Badge variant="secondary">{t("coParentSig")}</Badge>}
                  {cfg.signatures.student && <Badge variant="secondary">{t("studentSig")}</Badge>}
                  <Badge variant="secondary">
                    {t("agreementsCount", { n: cfg.agreements.length })}
                  </Badge>
                </div>
              </div>
              <div className="sm:col-span-2">
                <p className="mb-1 font-semibold">{t("decisionTemplates")}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["acceptance", "declination", "waitlist"] as const).map((k) => (
                    <p key={k} className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                      <span className="mb-1 block font-medium text-foreground">
                        {t(`template_${k}`)}
                      </span>
                      {cfg.decisionTemplates[k]}
                    </p>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t("editNote")}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
