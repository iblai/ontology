"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Menu, Plus, Search } from "lucide-react";
import { useSidebar } from "@iblai/iblai-js/web-containers/next";
import { NotificationDropdown } from "@iblai/iblai-js/web-containers";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCommandPalette } from "@/components/shell/command-palette";
import { CREATE_ACTIONS, crumbsFor } from "@/components/shell/nav-config";
import { apiClient } from "@/lib/ontology/api-client";
import type { GatewayHealth } from "@/lib/ontology/types";
import { cn } from "@/lib/utils";
import { CreditBalanceWidget } from "./credit-balance-widget";
import { UserProfileButton } from "./user-profile-button";

interface NavBarProps {
  tenantKey: string;
  username?: string;
  isAdmin: boolean;
  currentTenant?: any;
  userTenants?: any[];
  authURL: string;
  onLogout: () => void;
  onTenantChange: (key: string) => void;
  /** No backend configured: the console serves its mock data. */
  demo: boolean;
  /** Hosted mode without a backend this member may use: nothing to create or report. */
  noBackend?: boolean;
}

/**
 * The top bar, the SIS bar's shape (h-16, white, `#D0E0FF` hairline, the system font):
 * the phone menu + breadcrumbs; the ⌘K search field; New, the data source, credits,
 * the SDK bell and the SDK profile dropdown. It starts and ends on the content line.
 */
export function NavBar({
  tenantKey,
  username,
  isAdmin,
  currentTenant,
  userTenants,
  authURL,
  onLogout,
  onTenantChange,
  demo,
  noBackend = false,
}: NavBarProps) {
  const t = useTranslations("shell");
  const router = useRouter();
  const { toggleSidebar, isMobile } = useSidebar();

  const handleViewNotifications = useCallback(
    (notificationId?: string) => router.push(`/notifications/${notificationId ?? ""}`),
    [router],
  );

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#D0E0FF] bg-white px-4 font-[ui-sans-serif,system-ui,sans-serif] md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {/* Phones only, as in the OS: on desktop the SDK sidebar has its own toggle.
            `-ml-2` puts the glyph, not the button, on the content line. */}
        {isMobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-ml-2 shrink-0 text-[#646464]"
                onClick={toggleSidebar}
                aria-label={t("toggleSidebar")}
              >
                <Menu className="size-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("toggleSidebar")}</TooltipContent>
          </Tooltip>
        )}
        <Breadcrumbs />
      </div>

      <SearchField />

      <div className="flex flex-1 items-center justify-end gap-3 lg:gap-4">
        {!noBackend && <NewMenu />}
        {!noBackend && <DataSource demo={demo} />}
        <CreditBalanceWidget />
        <NotificationDropdown
          org={tenantKey}
          userId={username ?? ""}
          isAdmin={isAdmin}
          onViewNotifications={handleViewNotifications}
        />
        {/* The SDK's 40 px trigger insets its 32 px avatar by 4 px; this puts the avatar on the line. */}
        <div className="-mr-1">
          <UserProfileButton
            username={username}
            isAdmin={isAdmin}
            tenantKey={tenantKey}
            currentTenant={currentTenant}
            userTenants={userTenants}
            authURL={authURL}
            onLogout={onLogout}
            onTenantChange={onTenantChange}
          />
        </div>
      </div>
    </header>
  );
}

function Breadcrumbs() {
  const t = useTranslations("shell");
  const tn = useTranslations("nav");
  const crumbs = crumbsFor(usePathname() ?? "/");

  return (
    <nav aria-label={t("breadcrumbs")} className="flex min-w-0 items-center text-sm font-medium">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        const label = crumb.raw ? crumb.label : tn(crumb.label);
        return (
          <span key={i} className={cn("min-w-0 items-center", last ? "flex" : "hidden sm:flex")}>
            {i > 0 && (
              <ChevronRight
                className={cn("mx-1 size-3.5 shrink-0 text-[#646464]", last && "hidden sm:block")}
              />
            )}
            {crumb.href && !last ? (
              <Link
                href={crumb.href}
                className="max-w-[12rem] truncate text-[#646464] hover:text-[#484848]"
              >
                {label}
              </Link>
            ) : (
              <span
                aria-current={last ? "page" : undefined}
                className={cn("truncate text-[#646464]", last ? "max-w-[20rem]" : "max-w-[12rem]")}
              >
                {label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function SearchField() {
  const t = useTranslations("shell");
  const { open } = useCommandPalette();
  const [mac, setMac] = useState(false);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.userAgent)), []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden h-9 w-full max-w-sm min-w-0 items-center gap-2 rounded-lg border border-[#e2e8f0] bg-[#fafafa] px-3 text-[13px] text-[#8a8b8f] transition-colors hover:border-[#cbd5e1] hover:bg-white md:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{t("searchPlaceholder")}</span>
        <kbd className="rounded border border-[#e2e8f0] bg-white px-1.5 font-sans text-[11px] text-[#646464]">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-[#646464] md:hidden"
        onClick={open}
        aria-label={t("search")}
      >
        <Search className="size-5" />
      </Button>
    </>
  );
}

function NewMenu() {
  const t = useTranslations("shell");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="hidden gap-1 md:inline-flex">
          <Plus className="size-4" />
          {t("new")}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {CREATE_ACTIONS.map((action) => (
          <DropdownMenuItem key={action.id} asChild>
            <Link href={action.href}>
              <action.icon className="size-4" />
              {t(action.labelKey)}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Demo data, a local backend (no public gateway URL), or the live gateway as the backend reports it. */
function DataSource({ demo }: { demo: boolean }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const [gateway, setGateway] = useState<GatewayHealth | Error | null>(null);

  useEffect(() => {
    if (demo) return;
    apiClient.mcp
      .status()
      .then(setGateway, (e: unknown) => setGateway(e instanceof Error ? e : new Error(String(e))));
  }, [demo, pathname]);

  const failed = !demo && gateway instanceof Error;
  const [dot, label, hint] = demo
    ? ["bg-[#9ca3af]", t("demo"), t("demoHint")]
    : gateway instanceof Error
      ? ["bg-red-500", t("unreachable"), gateway.message]
      : !gateway
        ? ["bg-[#d4d4d8]", t("live"), t("checking")]
        : !gateway.url
          ? [
              "bg-emerald-500",
              t("liveLocal"),
              t("liveLocalHint", { tools: gateway.tool_count, toolsets: gateway.toolset_count }),
            ]
          : [
              gateway.running ? "bg-emerald-500" : "bg-amber-500",
              gateway.running ? t("liveSessions", { n: gateway.active_sessions }) : t("liveDown"),
              t("liveHint", {
                url: gateway.url,
                tools: gateway.tool_count,
                toolsets: gateway.toolset_count,
              }),
            ];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/mcp"
          className={cn(
            "hidden h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors lg:flex",
            failed
              ? "border-red-200 text-red-700 hover:bg-red-50"
              : "border-[#e2e8f0] text-[#646464] hover:bg-[#f4f4f4]",
          )}
        >
          <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
          {label}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
