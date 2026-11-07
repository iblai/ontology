"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSelector } from "react-redux";
import { Plus } from "lucide-react";
import {
  PlatformSidebar,
  PlatformAccountSheet,
  PlatformSidebarNavDivider,
  useSidebar,
} from "@iblai/iblai-js/web-containers/next";
import type {
  PlatformSidebarSectionConfig,
  PlatformSidebarFooterActionId,
  PlatformAccountTab,
} from "@iblai/iblai-js/web-containers/next";
import { InviteUserDialog } from "@iblai/iblai-js/web-containers";
import { selectRbacPermissions } from "@iblai/iblai-js/web-utils";
import config from "@/lib/iblai/config";
import { apiClient } from "@/lib/ontology/api-client";
import { CATALOG } from "@/lib/ontology/catalog";
import type { QuickCounts } from "@/lib/ontology/types";
import { cn } from "@/lib/utils";
import { NavRow } from "./nav-row";
import { PLATFORM_SIDEBAR_SECTIONS } from "./nav-config";

/**
 * The console sidebar, built on the ibl.ai SDK's `PlatformSidebar`.
 *
 * Every page is a flat row (`NavRow`) under its group heading, with live counts; "Add a
 * service" is the primary action. Wide viewport: a rail that collapses to icons with label
 * flyouts. Narrow viewport: a drawer opened from the top bar. Both are driven by the SDK
 * `SidebarProvider` in `app-shell.tsx`.
 *
 * Footer: the SDK's admin cluster, gated by REAL RBAC (`rbacPermissions` from
 * the `rbac` slice hydrated by `TenantProvider`). Actions mirror the ibl.ai
 * platform (see the OS reference): Notifications → its page, Invites → the SDK
 * `InviteUserDialog`, and Management/Integrations/Advanced/Monetization → the
 * SDK `PlatformAccountSheet` (one dialog, tab-switched). Support is the SDK's
 * built-in link (https://ibl.ai/docs).
 */
export function PlatformAppSidebar({
  isAdmin,
  tenantKey,
  username,
  email,
}: {
  isAdmin: boolean;
  tenantKey: string;
  username: string;
  email: string;
}) {
  const t = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const rbacPermissions = useSelector(selectRbacPermissions);
  const [accountTab, setAccountTab] = useState<PlatformAccountTab | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [counts, setCounts] = useState<(QuickCounts & { catalog: number }) | null>(null);

  // Refetched on every navigation so a create shows up; hidden when the backend fails (the top bar says so).
  useEffect(() => {
    apiClient.counts().then(
      (c) => setCounts({ ...c, catalog: CATALOG.length }),
      () => setCounts(null),
    );
  }, [pathname]);

  const sections: PlatformSidebarSectionConfig[] = PLATFORM_SIDEBAR_SECTIONS.map((group, i) => ({
    type: "custom" as const,
    id: group.id,
    render: (ctx) => (
      <div className={cn("flex flex-col", ctx.collapsed && "w-full items-center")}>
        {ctx.collapsed ? (
          i > 0 && <PlatformSidebarNavDivider />
        ) : (
          <p
            className={cn(
              "px-2 pb-1 text-[11px] font-medium tracking-wider text-[#8a8b8f] uppercase",
              i > 0 ? "pt-4" : "pt-2",
            )}
          >
            {t(group.labelKey)}
          </p>
        )}
        <ul className={cn("flex flex-col gap-0.5", ctx.collapsed && "items-center")}>
          {group.items.map((item) => (
            <li key={item.href}>
              <NavRow
                collapsed={ctx.collapsed}
                icon={item.icon}
                label={t(item.labelKey)}
                href={item.href}
                count={item.count && counts ? counts[item.count] : undefined}
                onAfterNav={ctx.onAfterNav}
              />
            </li>
          ))}
        </ul>
      </div>
    ),
  }));

  const onFooterAction = (id: PlatformSidebarFooterActionId) => {
    if (id === "notifications") router.push("/notifications");
    else if (id === "invites") setShowInvite(true);
    // management | integrations | advanced | monetization — PlatformAccountTab.
    else setAccountTab(id as PlatformAccountTab);
  };

  return (
    <>
      <PlatformSidebar
        // h-11 makes the SDK header 64 px, so its toggle centres on the top bar's line.
        logo={
          <Link
            href="/dashboard"
            className="flex h-11 items-center"
            onClick={() => isMobile && setOpenMobile(false)}
          >
            <Image
              src="/iblai-logo.webp"
              alt="ibl.ai"
              width={256}
              height={108}
              className="h-10 w-auto"
              priority
            />
          </Link>
        }
        // The SDK leaves the phone sheet open for its primary action; close it first.
        primaryAction={{
          label: t("addService"),
          icon: Plus,
          onClick: () => {
            if (isMobile) setOpenMobile(false);
            router.push("/services/add");
          },
        }}
        sections={sections}
        footer={{
          isAdmin,
          isLiveAdmin: isAdmin,
          enableRbac: true,
          rbacPermissions,
          tenantKey,
          currentTenant: { key: tenantKey, enable_monetization: false },
          notificationsAllowed: true,
          invitesUserTypeAllowed: true,
          onAction: onFooterAction,
        }}
      />
      <PlatformAccountSheet
        tab={accountTab}
        onClose={() => setAccountTab(null)}
        tenantKey={tenantKey}
        username={username}
        email={email}
        onInviteClick={() => setShowInvite(true)}
        mainPlatformKey={config.mainTenantKey()}
        authUrl={config.authUrl()}
        currentSpa="agent"
        platformBaseDomain={config.platformBaseDomain()}
      />
      <InviteUserDialog
        isOpen={showInvite}
        onClose={() => setShowInvite(false)}
        tenant={tenantKey}
      />
    </>
  );
}
