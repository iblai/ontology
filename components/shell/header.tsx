"use client";

/* eslint-disable @typescript-eslint/no-explicit-any -- the SDK does not export its Tenant type */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Box, Check, ChevronDown, CreditCard, Menu, Network } from "lucide-react";
import { toast } from "sonner";
import { NotificationDropdown } from "@iblai/iblai-js/web-containers";
import { UserProfileDropdown } from "@iblai/iblai-js/web-containers/next";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { handleLogout, redirectToAuthSpa } from "@/lib/iblai/auth-utils";
import { tenantLabel, useSession } from "@/lib/iblai/session";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/map": "Map",
  "/systems": "Systems",
  "/catalog": "Catalog",
  "/sync": "Compilation",
  "/ontology": "Ontology",
  "/mcp": "MCP Gateway",
  "/roles": "Roles",
  "/access": "Access",
  "/agents": "Agents",
  "/config": "Config",
  "/notifications": "Notifications",
};

const iconBtn =
  "grid size-[34px] shrink-0 place-items-center rounded-md text-gray-700 hover:bg-[var(--hover-bg)]";

function OrgSwitcher() {
  const s = useSession();
  const switchTo = (key: string) => {
    if (key === s.tenantKey) return;
    if (s.demo) {
      toast(
        "Switching organizations signs you in to the other organization. Not available in demo mode.",
      );
      return;
    }
    localStorage.setItem("app_tenant", key);
    redirectToAuthSpa(undefined, key, false, true);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-[var(--hover-bg)] data-[popup-open]:bg-[var(--hover-bg)]"
        aria-label="Switch organization"
      >
        <Box className="size-4 shrink-0 text-gray-500" />
        <span className="max-w-[38vw] truncate sm:max-w-[220px]">
          {s.tenantName || "Organization"}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-gray-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {s.tenants.length === 0 && <DropdownMenuItem disabled>{s.tenantName}</DropdownMenuItem>}
          {s.tenants.map((t) => (
            <DropdownMenuItem key={t.key} onClick={() => switchTo(t.key)}>
              <span className="min-w-0 flex-1 truncate">{tenantLabel(t, t.key)}</span>
              {t.key === s.tenantKey && <Check className="size-4 text-[var(--primary-color)]" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="text-xs">
          One ontology per organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Avatar() {
  const s = useSession();
  if (s.demo) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="ml-1 grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0ea5e9] to-[#0058cc] text-xs font-semibold text-white"
          aria-label="Account menu"
        >
          {s.initials}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="block truncate font-semibold text-gray-900">{s.displayName}</span>
              <span className="block truncate text-xs font-normal">{s.email}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>Demo mode · not signed in</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <div className="ml-1 shrink-0">
      <UserProfileDropdown
        email={s.email}
        mainPlatformKey={s.mainPlatformKey}
        username={s.username}
        userIsAdmin={s.isAdmin}
        userIsStudent={false}
        tenantKey={s.tenantKey}
        currentTenant={s.currentTenant as any}
        userTenants={s.tenants as any}
        showProfileTab
        showAccountTab={false}
        showTenantSwitcher={false}
        showOrganizationsLink={false}
        showHelpLink
        helpCenterUrl="https://docs.ibl.ai"
        showLogoutButton
        showLearnerModeSwitch={false}
        currentPlan=""
        currentSPA="agent"
        avatarSize={32}
        authURL={s.authUrl}
        onLogout={() => handleLogout()}
        onTenantUpdate={() => {}}
      />
    </div>
  );
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const s = useSession();
  const shell = useShell();
  const base = "/" + (pathname.split("/")[1] || "dashboard");
  const title = titles[base] ?? "Ontology";

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border-color)] bg-[var(--navbar-bg,#fff)] pr-3 pl-2 sm:gap-2 sm:pr-5 sm:pl-3">
      <button
        type="button"
        onClick={shell.openMobileNav}
        className={cn(iconBtn, "md:hidden")}
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </button>

      <OrgSwitcher />
      <span className="hidden truncate text-sm text-gray-400 sm:inline">· {title}</span>

      <div className="min-w-0 flex-1" />

      {s.isAdmin && (
        <div className="mr-2 hidden items-center gap-2 text-sm text-gray-500 lg:flex">
          <span className={cn(!s.adminMode && "font-semibold text-gray-900")}>User</span>
          <Switch
            checked={s.adminMode}
            onCheckedChange={(on: boolean) => s.setAdminMode(on)}
            aria-label="Admin mode"
          />
          <span className={cn(s.adminMode && "font-semibold text-gray-900")}>Admin</span>
        </div>
      )}
      <Link
        href="/map"
        className={cn(iconBtn, "hidden sm:grid")}
        title="Systems map"
        aria-label="Systems map"
      >
        <Network className="size-4" />
      </Link>
      {s.liveAdmin && (
        <button
          type="button"
          onClick={() => shell.openAccount("billing")}
          className={cn(iconBtn, "hidden sm:grid")}
          title="Billing"
          aria-label="Billing"
        >
          <CreditCard className="size-4" />
        </button>
      )}
      {s.demo ? (
        <Link
          href="/notifications"
          className={iconBtn}
          title="Notifications"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
        </Link>
      ) : (
        <NotificationDropdown
          org={s.tenantKey}
          userId={s.username}
          isAdmin={s.isAdmin}
          onViewNotifications={(id?: string) => router.push(`/notifications/${id ?? ""}`)}
        />
      )}
      <Avatar />
    </header>
  );
}
