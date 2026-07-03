"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { getApplicationForFamily, getSchool, type FamilyApplicationView } from "@/lib/api";
import type { SchoolConfig } from "@/lib/schools";

// Post-submission confirmation. PDF §2.1: unique ID + confirmation.
export default function StatusPage() {
  const t = useTranslations("applyStatus");
  const [app, setApp] = useState<FamilyApplicationView | null>(null);
  const [cfg, setCfg] = useState<SchoolConfig | null>(null);

  useEffect(() => {
    (async () => {
      const id = new URLSearchParams(window.location.search).get("id");
      if (!id) return;
      try {
        const a = await getApplicationForFamily(id);
        setApp(a);
        setCfg(await getSchool(a.schoolSlug));
      } catch {
        // stays on the empty state
      }
    })();
  }, []);

  if (!app || !cfg) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#fafafa] p-6">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center bg-[#fafafa] px-4 py-12">
      <Image
        src={cfg.logo}
        alt={cfg.name}
        width={200}
        height={44}
        className="h-11 w-auto object-contain"
      />
      <Card className="mt-8 w-full max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <CheckCircle2 className="size-12 text-emerald-600" />
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("body", { school: cfg.name })}</p>
          <div className="rounded-lg bg-muted/40 px-6 py-3">
            <p className="text-xs text-muted-foreground">{t("applicationId")}</p>
            <p className="font-mono text-lg font-semibold">{app.id}</p>
          </div>
          <div className="w-full space-y-2 text-left">
            {app.students.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm"
              >
                <span>
                  {s.legalFirstName} {s.legalLastName}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t("grade", { grade: s.gradeLevel })}
                  </span>
                </span>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
          <div className="w-full rounded-lg bg-blue-50 p-4 text-left text-sm text-blue-900">
            <p className="font-medium">{t("nextStepsTitle")}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
              <li>{t("nextStep1")}</li>
              <li>{t("nextStep2")}</li>
              <li>{t("nextStep3")}</li>
            </ul>
          </div>
          <Button asChild>
            <Link href="/login">{t("goToPortal")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
