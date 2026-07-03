"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, ChevronDown, LogOut, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { navItemsForRole } from "./nav-config";
import { notificationKeys, useSession } from "@/lib/session";
import { listNotifications, markNotificationRead } from "@/lib/api";
import type { AppNotification } from "@/lib/types";
import { fmtDateTime, initials } from "@/lib/format";

// Top header — mirrors the OS nav-bar (h-16, white, border #D0E0FF, text #646464).
export function NavBar() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useSession();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setNotifications(await listNotifications(notificationKeys(user)));
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  if (!user) return null;

  const items = navItemsForRole(user.role);
  const current = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const unread = notifications.filter((n) => !n.readAt);

  const openNotification = async (n: AppNotification) => {
    if (!n.readAt) await markNotificationRead(n.id);
    await refresh();
    if (n.href) router.push(n.href);
  };

  return (
    <nav className="z-10 flex h-16 shrink-0 items-center border-b border-[#D0E0FF] bg-white pr-4">
      <SidebarTrigger className="ml-4 md:hidden" />
      <h1 className="ml-4 truncate text-sm font-medium text-[#646464]">
        {current ? t(current.labelKey) : tc("appName")}
      </h1>
      <div className="flex-1" />

      {/* Notifications bell */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="relative text-[#646464]">
            <Bell className="h-5 w-5" />
            {unread.length > 0 && (
              <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
                {unread.length > 9 ? "9+" : unread.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>{tc("notifications")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {notifications.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{tc("noResults")}</p>
          )}
          {notifications.slice(0, 8).map((n) => (
            <DropdownMenuItem
              key={n.id}
              onClick={() => openNotification(n)}
              className="flex cursor-pointer flex-col items-start gap-0.5 py-2"
            >
              <span className="flex w-full items-center gap-2">
                {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                <span className="truncate text-sm font-medium">{n.title}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
              <span className="text-[11px] text-muted-foreground">{fmtDateTime(n.createdAt)}</span>
            </DropdownMenuItem>
          ))}
          {user.role === "parent" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer justify-center text-sm">
                <Link href="/parent/notifications">{t("notifications")}</Link>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Profile dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="ml-1 flex items-center gap-2 text-sm font-medium text-[#646464]"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-[#0ea5e9] text-[11px] font-semibold text-white">
              {initials(user.name)}
            </span>
            <span className="hidden sm:block">{user.name}</span>
            <ChevronDown className="h-4 w-4 text-gray-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col">
            <span>{user.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{tr(user.role)}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="cursor-pointer">
            <Link href="/login">
              <UserRound className="h-4 w-4" />
              {tc("switchRole")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => {
              signOut();
              router.push("/login");
            }}
          >
            <LogOut className="h-4 w-4" />
            {tc("signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
