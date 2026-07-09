"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { NAV_SECTIONS } from "./nav-config";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";

export function AppSidebar() {
  const pathname = usePathname() ?? "";
  const t = useTranslations("nav");

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <Image src="/iblai-logo.png" alt="ibl.ai" width={28} height={28} className="rounded" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
              {t("consoleHome")}
            </span>
            <span className="text-xs text-muted-foreground">iblai/ontology</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {NAV_SECTIONS.map((section, i) => (
          <div key={section.labelKey}>
            {i > 0 && <SidebarSeparator />}
            <SidebarGroup>
              <SidebarGroupLabel>{t(section.labelKey)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={active}>
                          <Link href={item.href}>
                            <Icon className="size-4" />
                            <span>{t(item.labelKey)}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
        <span className="text-xs text-muted-foreground">On-premise · MCP</span>
      </SidebarFooter>
    </Sidebar>
  );
}
