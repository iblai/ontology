"use client";

import { useParams } from "next/navigation";
import { NotificationDisplay } from "@iblai/iblai-js/web-containers";
import { PageHeader } from "@/components/shell/page-header";
import { DemoNotice } from "@/components/shell/account-dialog";
import { useSession } from "@/lib/iblai/session";

export default function NotificationsPage() {
  const params = useParams();
  const id = (params?.id as string[] | undefined)?.[0];
  const s = useSession();

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Messages from your ibl.ai organization, including alerts about agents that call ontology servers."
      />
      {s.demo ? (
        <DemoNotice what="notifications" />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-[10px] border border-[var(--border-color)]">
          <NotificationDisplay
            org={s.tenantKey}
            userId={s.username}
            isAdmin={s.isAdmin}
            selectedNotificationId={id}
            tenant={s.tenantKey}
          />
        </div>
      )}
    </>
  );
}
