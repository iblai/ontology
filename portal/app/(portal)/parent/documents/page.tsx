"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { FileUploadStub } from "@/components/shared/file-upload-stub";
import { getFamilyApplications, uploadDocument } from "@/lib/api";
import { getSchoolConfig } from "@/lib/schools";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDate } from "@/lib/format";

export default function ParentDocumentsPage() {
  const t = useTranslations("parentDocs");
  const user = useRequireRole(["parent"]);
  const { data: apps, reload } = useLoad(async () => {
    if (!user) return undefined;
    return getFamilyApplications(user.email!);
  }, [user]);

  if (!user || !apps) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      {apps.length === 0 && <EmptyState title={t("empty")} />}
      <div className="space-y-4">
        {apps.map((app) => {
          const cfg = getSchoolConfig(app.schoolSlug);
          return (
            <Card key={app.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  {cfg?.name ?? app.schoolSlug} · {app.id}
                </CardTitle>
                <FileUploadStub
                  onUpload={async (meta) => {
                    await uploadDocument(app.id, meta);
                    toast.success(t("uploaded"));
                    await reload();
                  }}
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold">{t("uploads")}</h3>
                  {app.documents.length === 0 && (
                    <p className="text-sm text-muted-foreground">{t("noUploads")}</p>
                  )}
                  <ul className="space-y-1 text-sm">
                    {app.documents.map((d) => (
                      <li key={d.id} className="flex justify-between gap-2">
                        <span className="truncate">{d.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {(d.sizeBytes / 1024).toFixed(0)} KB · {fmtDate(d.uploadedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold">{t("agreements")}</h3>
                  <ul className="space-y-1 text-sm">
                    {app.acknowledgments.map((a) => (
                      <li key={a.id} className="flex items-start gap-2">
                        {a.checked ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          {a.label}
                          {a.handbookVersion && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({t("version")} {a.handbookVersion})
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {cfg && (
                  <a
                    href={cfg.handbook.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    {t("handbookLink", { version: cfg.handbook.version })}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
