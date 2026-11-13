"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { NavBar } from "@/components/navbar/nav-bar";
import { BackendNotice, useBackendGate } from "@/components/shell/backend-gate";
import { PlatformAppSidebar } from "@/components/shell/platform-app-sidebar";
import { SetupBackend } from "@/components/shell/setup-backend";
import { CommandPaletteProvider } from "@/components/shell/command-palette";
import { SidebarInset, SidebarProvider } from "@iblai/iblai-js/web-containers/next";
import { clearCurrentTenantCookie, handleTenantSwitch } from "@iblai/iblai-js/web-utils";
import { resolveAppTenant } from "@/lib/iblai/tenant";
import { handleLogout } from "@/lib/iblai/auth-utils";
import { pendingSetup } from "@/lib/ontology/install";
import config from "@/lib/iblai/config";
import { cn } from "@/lib/utils";

export function AppShell({
  defaultSidebarOpen,
  demo,
  hosted,
  children,
}: {
  defaultSidebarOpen: boolean;
  /** No backend configured: the console serves its mock data. */
  demo: boolean;
  /** One console for every platform: each finds, and may connect, its own backend. */
  hosted: boolean;
  children: React.ReactNode;
}) {
  // The semantic map page's content is dark below the navbar; every other page is light.
  const dark = usePathname() === "/map";
  const gate = useBackendGate(!demo);
  // An install's link kept for this tab: its card stands in for the page until it is used or dropped.
  const [setup] = useState(() => (hosted ? pendingSetup() : null));
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
    <CommandPaletteProvider hosted={hosted}>
      <SidebarProvider defaultOpen={defaultSidebarOpen}>
        <PlatformAppSidebar
          hosted={hosted}
          isAdmin={isAdmin}
          tenantKey={tenantKey}
          username={username}
          email={email}
        />
        <SidebarInset className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white">
          <NavBar
            demo={demo}
            noBackend={gate !== "open"}
            tenantKey={tenantKey}
            username={username}
            isAdmin={isAdmin}
            currentTenant={currentTenant}
            userTenants={userTenants}
            authURL={config.authUrl()}
            onLogout={handleLogout}
            // The SDK's switch: stores `tenant` and fetches the new platform's tokens from the auth app.
            onTenantChange={(newKey: string) =>
              void handleTenantSwitch(newKey, {
                authUrl: config.authUrl(),
                clearCurrentTenantCookie,
              })
            }
          />
          <main
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-4 md:p-6",
              dark && "dark overflow-hidden bg-background p-0 text-foreground md:p-0",
            )}
          >
            {setup ? (
              <SetupBackend link={setup} />
            ) : gate === "open" ? (
              children
            ) : (
              gate !== "checking" && <BackendNotice gate={gate} />
            )}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </CommandPaletteProvider>
  );
}
