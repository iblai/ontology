"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiClient } from "@/lib/ontology/api-client";
import { SectionHeader } from "@/components/console/section-header";
import { ConnectBackend } from "@/components/shell/connect-backend";
import { Skeleton } from "@/components/ui/skeleton";

/** Where this platform's backend is, with the way to connect another in its place. */
export function BackendClient() {
  const t = useTranslations("backendPage");
  // null while the platform is asked; "" when it keeps no usable address.
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    apiClient.hosted.backend().then(
      (kept) => setCurrent(kept.url ?? ""),
      (e: unknown) => {
        toast.error(e instanceof Error ? e.message : String(e));
        setCurrent("");
      },
    );
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("title")}
        subtitle={current ? t("connected", { url: current }) : t("subtitle")}
      />
      {current === null ? (
        <Skeleton className="h-96 rounded-lg" />
      ) : (
        <ConnectBackend
          // A new address starts the form again from it.
          key={current}
          current={current}
          onConnected={(url) => {
            toast.success(t("connected", { url }));
            setCurrent(url);
          }}
        />
      )}
    </div>
  );
}
