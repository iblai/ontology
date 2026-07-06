"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/shared/page-header";
import { listNotifications, markNotificationRead } from "@/lib/api";
import { notificationKeys, useRequireRole } from "@/lib/session";
import { useLoad } from "@/lib/hooks";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ParentNotificationsPage() {
  const t = useTranslations("notifications");
  const user = useRequireRole(["parent"]);
  const { data: notifications, reload } = useLoad(async () => {
    if (!user) return undefined;
    return listNotifications(notificationKeys(user));
  }, [user]);

  if (!user || !notifications) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("title")} />
      {notifications.length === 0 && <EmptyState title={t("empty")} />}
      <div className="space-y-2">
        {notifications.map((n) => (
          <Card key={n.id} className={cn("py-3", !n.readAt && "border-primary/30 bg-accent/40")}>
            <CardContent className="flex items-start gap-3 px-4">
              {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-sm text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{fmtDateTime(n.createdAt)}</p>
              </div>
              {n.href && (
                <Link
                  href={n.href}
                  onClick={() => void markNotificationRead(n.id).then(reload)}
                  className="shrink-0 text-sm text-primary hover:underline"
                >
                  {t("view")}
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
