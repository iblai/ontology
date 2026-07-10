"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSelector } from "react-redux";
import { PlatformSidebar, PlatformAccountSheet } from "@iblai/iblai-js/web-containers/next";
import type {
  PlatformSidebarSectionConfig,
  PlatformSidebarFooterActionId,
  PlatformAccountTab,
} from "@iblai/iblai-js/web-containers/next";
import { InviteUserDialog } from "@iblai/iblai-js/web-containers";
import { selectRbacPermissions } from "@iblai/iblai-js/web-utils";
import config from "@/lib/iblai/config";
import { PLATFORM_SIDEBAR_SECTIONS } from "./nav-config";

/**
 * The console sidebar, built on the ibl.ai SDK's `PlatformSidebar`.
 *
 * Wide viewport: persistent rail that collapses to icons (hover flyouts).
 * Narrow viewport: a drawer opened from the navbar hamburger. Both are driven
 * by the SDK `SidebarProvider` in `app-shell.tsx`. Active state is derived by
 * the SDK from each item's `href` (via `usePathname`).
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
  const rbacPermissions = useSelector(selectRbacPermissions);
  const [accountTab, setAccountTab] = useState<PlatformAccountTab | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const sections: PlatformSidebarSectionConfig[] = PLATFORM_SIDEBAR_SECTIONS.map((group) => ({
    type: "menu" as const,
    menu: {
      id: group.id,
      label: t(group.labelKey),
      icon: group.icon,
      items: group.items.map((item) => ({
        id: item.href,
        label: t(item.labelKey),
        href: item.href,
      })),
    },
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
        logo={
          <Link href="/dashboard" className="flex items-center">
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
