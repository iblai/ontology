"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { NavBar } from "@/components/navbar/nav-bar";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useSession } from "@/lib/session";
import { resolveAppTenant } from "@/lib/iblai/tenant";
import { handleLogout } from "@/lib/iblai/auth-utils";
import config from "@/lib/iblai/config";
import { cn } from "@/lib/utils";

// Portal routes share the collapsible sidebar (parent/student/admin portals).
const PORTAL_RE = /^\/(parent|student|admin)(\/|$)/;

export function AppShell({
  defaultSidebarOpen,
  children,
}: {
  defaultSidebarOpen: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const { user } = useSession();
  const [mounted, setMounted] = useState(false);
  const [tenantKey, setTenantKey] = useState("");
  const [username, setUsername] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setTenantKey(resolveAppTenant());
    try {
      const raw = localStorage.getItem("userData");
      if (raw) {
        const parsed = JSON.parse(raw) as {
          user_nicename?: string;
          username?: string;
        };
        setUsername(parsed.user_nicename ?? parsed.username ?? "");
      }
    } catch {}
    try {
      const raw = localStorage.getItem("tenants");
      if (raw) {
        const parsed = JSON.parse(raw) as Array<{ key: string; is_admin?: boolean }>;
        const match = parsed.find((t) => t.key === resolveAppTenant());
        if (match) setIsAdmin(!!match.is_admin);
      }
    } catch {}
  }, []);

  if (!mounted)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );

  const isPortal = PORTAL_RE.test(pathname);
  const showHamburger = isPortal && !!user;

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      {isPortal && <AppSidebar />}
      <SidebarInset className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white">
        <NavBar
          showHamburger={showHamburger}
          tenantKey={tenantKey}
          username={username}
          isAdmin={isAdmin}
          authURL={config.authUrl()}
          onLogout={handleLogout}
          onTenantChange={(newKey: string) => {
            localStorage.setItem("app_tenant", newKey);
            window.location.href = "/";
          }}
        />
        <main className={cn("min-h-0 flex-1 overflow-y-auto", isPortal && "p-4 md:p-6")}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}