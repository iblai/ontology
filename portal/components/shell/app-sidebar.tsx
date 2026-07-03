"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { isNavItemActive, navItemsForRole } from "./nav-config";
import { useSession } from "@/lib/session";
import { initials } from "@/lib/format";

// App sidebar — mirrors the OS app shell (bg #fafafa, border #e9e9ea, active #cfe8fa).
export function AppSidebar() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const pathname = usePathname();
  const { user, signOut } = useSession();

  if (!user) return null;
  const items = navItemsForRole(user.role);

  return (
    <Sidebar collapsible="icon" className="border-r border-[#e9e9ea]">
      <SidebarHeader className="shrink-0 bg-[#fafafa] px-[10px] py-[10px]">
        <div className="flex items-center gap-2 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Image
            src="/iblai-logo.png"
            alt="ibl.ai"
            width={120}
            height={34}
            className="h-[34px] w-auto max-w-full object-contain object-left group-data-[collapsible=icon]:hidden"
          />
          <div className="flex-1 group-data-[collapsible=icon]:hidden" />
          <SidebarTrigger className="size-7 shrink-0 rounded-md text-[#7d7e82] hover:bg-[#f0f0f0]" />
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-[#fafafa] px-2 pt-1 pb-2">
        <SidebarMenu className="space-y-0.5">
          {items.map((item) => {
            const active = isNavItemActive(item, pathname);
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={t(item.labelKey)}
                  className="h-9 gap-2 rounded-md px-2 text-[14px] font-normal text-gray-700 hover:bg-[#f4f4f4] data-[active=true]:bg-[#cfe8fa]/40 data-[active=true]:font-normal data-[active=true]:hover:bg-[#cfe8fa]/50"
                >
                  <Link href={item.href}>
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="shrink-0 border-t border-[#e2e8f0] bg-[#fafafa] px-2 py-3">
        <div className="flex items-center gap-2 rounded-md px-2 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#0ea5e9] text-[11px] font-semibold text-white">
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-[13px] font-medium text-[#5f5f61]">{user.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{tr(user.role)}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            title={tc("signOut")}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[#7d7e82] hover:bg-[#f0f0f0] group-data-[collapsible=icon]:hidden"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
