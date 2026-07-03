"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { GraduationCap, RotateCcw, School } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DEV_USERS, homeFor, useSession } from "@/lib/session";
import { resetDemoData } from "@/lib/api";
import { initials } from "@/lib/format";

export default function LoginPage() {
  const t = useTranslations("login");
  const tr = useTranslations("roles");
  const { signInAs } = useSession();
  const router = useRouter();

  const pick = (id: string, role: string) => {
    signInAs(id);
    router.push(homeFor(role as (typeof DEV_USERS)[number]["role"]));
  };

  const reset = async () => {
    if (!window.confirm(t("resetConfirm"))) return;
    await resetDemoData();
    toast.success(t("resetDone"));
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#fafafa] p-6">
      <div className="mb-8 flex flex-col items-center gap-3">
        <Image
          src="/iblai-logo.png"
          alt="ibl.ai"
          width={140}
          height={40}
          className="h-10 w-auto object-contain"
        />
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-2">
        {DEV_USERS.map((u) => (
          <Card
            key={u.id}
            role="button"
            tabIndex={0}
            onClick={() => pick(u.id, u.role)}
            onKeyDown={(e) => e.key === "Enter" && pick(u.id, u.role)}
            className="cursor-pointer py-4 transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <CardContent className="flex items-center gap-3 px-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#0ea5e9] text-sm font-semibold text-white">
                {u.role === "student" ? (
                  <GraduationCap className="size-5" />
                ) : u.role === "parent" ? (
                  initials(u.name)
                ) : (
                  <School className="size-5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{u.name}</span>
                  <Badge variant="secondary" className="shrink-0 text-[11px]">
                    {tr(u.role)}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{u.description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <p className="text-xs text-muted-foreground">{t("devNotice")}</p>
        <Button variant="outline" size="sm" onClick={reset}>
          <RotateCcw className="size-3.5" />
          {t("resetData")}
        </Button>
      </div>
    </div>
  );
}
