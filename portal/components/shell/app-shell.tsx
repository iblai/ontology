"use client";

import { useEffect, useState } from "react";
import { NavBar } from "@/components/navbar/nav-bar";
import { PlatformAppSidebar } from "@/components/shell/platform-app-sidebar";
import { SidebarInset, SidebarProvider } from "@iblai/iblai-js/web-containers/next";
import { resolveAppTenant } from "@/lib/iblai/tenant";
import { handleLogout } from "@/lib/iblai/auth-utils";
import config from "@/lib/iblai/config";
import { cn } from "@/lib/utils";

export function AppShell({
  defaultSidebarOpen,
  children,
}: {
  defaultSidebarOpen: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [tenantKey, setTenantKey] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  // The user's platforms + the active one, for the profile-dropdown tenant switcher.
  const [userTenants, setUserTenants] = useState<any[]>([]);
  const [currentTenant, setCurrentTenant] = useState<any>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setTenantKey(resolveAppTenant());
    try {
      const raw = localStorage.getItem("userData");
      if (raw) {
        const parsed = JSON.parse(raw) as {
          user_nicename?: string;
          username?: string;
          email?: string;
          user_email?: string;
        };
        setUsername(parsed.user_nicename ?? parsed.username ?? "");
        setEmail(parsed.email ?? parsed.user_email ?? "");
      }
    } catch {}
    try {
      const raw = localStorage.getItem("tenants");
      if (raw) {
        const parsed = JSON.parse(raw) as Array<{ key: string; is_admin?: boolean }>;
        setUserTenants(parsed);
        const match = parsed.find((t) => t.key === resolveAppTenant());
        if (match) {
          setCurrentTenant(match);
          setIsAdmin(!!match.is_admin);
        }
      }
    } catch {}
  }, []);

  if (!mounted)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <PlatformAppSidebar
        isAdmin={isAdmin}
        tenantKey={tenantKey}
        username={username}
        email={email}
      />
      <SidebarInset className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white">
        <NavBar
          showHamburger
          tenantKey={tenantKey}
          username={username}
          isAdmin={isAdmin}
          currentTenant={currentTenant}
          userTenants={userTenants}
          authURL={config.authUrl()}
          onLogout={handleLogout}
          onTenantChange={(newKey: string) => {
            localStorage.setItem("app_tenant", newKey);
            window.location.href = "/";
          }}
        />
        <main className={cn("min-h-0 flex-1 overflow-y-auto p-4 md:p-6")}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
