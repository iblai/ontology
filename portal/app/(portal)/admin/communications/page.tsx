"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { COMMUNICATION_TEMPLATES, listApplications, sendCommunication } from "@/lib/api";
import { renderTemplate, type CommunicationTemplateId } from "@/lib/api/templates";
import { useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDateTime } from "@/lib/format";

// Applicant communication log — PDF §12 (nice-to-have). Messages log to the
// family record; no real email is sent (ponytail: integration point).
export default function CommunicationsPage() {
  const t = useTranslations("communications");
  const user = useRequireRole(["afa_admin", "network_admin", "central_admin"]);
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const [template, setTemplate] = useState<CommunicationTemplateId | "">("");

  const { data: apps, reload } = useLoad(async () => {
    if (!user) return undefined;
    return listApplications();
  }, [user]);

  const log = useMemo(() => {
    if (!apps) return [];
    return apps
      .flatMap((app) =>
        app.communications.map((c) => ({
          ...c,
          appId: app.id,
          family: app.guardians[0] ? `${app.guardians[0].lastName} Family` : app.id,
        })),
      )
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  }, [apps]);

  if (!user || !apps) return null;
  const selectedApp = apps.find((a) => a.id === appId);

  const send = async () => {
    if (!appId || !template) return;
    await sendCommunication(appId, template);
    toast.success(t("sent"));
    setOpen(false);
    setTemplate("");
    await reload();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Send className="size-3.5" />
            {t("newMessage")}
          </Button>
        }
      />

      {log.length === 0 && <EmptyState title={t("empty")} description={t("emptyHint")} />}
      <div className="space-y-2">
        {log.map((c) => (
          <Card key={c.id} className="py-3">
            <CardContent className="px-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{c.subject}</p>
                <Link
                  href={`/admin/applications/${c.appId}`}
                  className="text-xs text-primary hover:underline"
                >
                  {c.family} · {c.appId}
                </Link>
              </div>
              <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{c.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {c.sentBy} · {fmtDateTime(c.sentAt)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("newMessage")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger>
                <SelectValue placeholder={t("pickFamily")} />
              </SelectTrigger>
              <SelectContent>
                {apps
                  .filter((a) => a.status !== "draft")
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.guardians[0] ? `${a.guardians[0].lastName} Family` : a.id} — {a.id}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Select
              value={template}
              onValueChange={(v) => setTemplate(v as CommunicationTemplateId)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("pickTemplate")} />
              </SelectTrigger>
              <SelectContent>
                {COMMUNICATION_TEMPLATES.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedApp && template && (
              <p className="rounded-md bg-muted/40 p-3 text-xs whitespace-pre-wrap">
                {renderTemplate(
                  COMMUNICATION_TEMPLATES.find((x) => x.id === template)!.body,
                  selectedApp,
                )}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button disabled={!appId || !template} onClick={send}>
              {t("send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
