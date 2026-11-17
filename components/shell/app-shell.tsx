"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { InviteUserDialog } from "@iblai/iblai-js/web-containers";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { handleLogout } from "@/lib/iblai/auth-utils";
import { useSession } from "@/lib/iblai/session";
import { currentTenantKey } from "@/lib/iblai/tenant";
import { relaying, storedServer } from "@/lib/server-address";
import { AccountDialog, DemoNotice } from "./account-dialog";
import { ConnectServer } from "./connect-server";
import { Header } from "./header";
import { ShellContext, type AccountTab, type ShellActions } from "./shell-context";
import { SidebarContent } from "./sidebar";
import { Walkthrough } from "./walkthrough";

const COLLAPSE_KEY = "ontology.sidebar.collapsed";

function NotAdmin() {
  const s = useSession();
  return (
    <div className="grid min-h-[50dvh] place-items-center text-center">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold text-gray-900">Administrators only</h1>
        <p className="mt-1 text-sm text-gray-600">
          The ontology console manages data sources, definitions and MCP servers for{" "}
          <b>{s.tenantName}</b>. Ask an administrator of this organization for access, or switch to
          an organization you administer.
        </p>
        <button
          type="button"
          onClick={() => handleLogout()}
          className="mt-4 text-sm font-medium text-[var(--primary-color)] hover:underline"
        >
          Sign in as someone else
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const s = useSession();
  // Client-only: the providers render this tree after mount, so storage is safe to read here.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<AccountTab | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const walkthrough = process.env.NEXT_PUBLIC_WALKTHROUGH !== "0";
  // Pages only: no server for this platform stands in for the page.
  const relayed = relaying() && !s.demo;
  const [connected] = useState(() => !relayed || !!storedServer(currentTenantKey()));
  const page = !s.isAdmin ? <NotAdmin /> : connected ? children : <ConnectServer />;

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  }, []);

  const actions = useMemo<ShellActions>(
    () => ({
      openAccount: setAccountTab,
      openInvite: () => setInviteOpen(true),
      openMobileNav: () => setMobileOpen(true),
    }),
    [],
  );

  return (
    <ShellContext.Provider value={actions}>
      <TooltipProvider>
        <div className="flex h-dvh overflow-hidden bg-[#f6f8fe]">
          <aside
            className="hidden h-full shrink-0 border-r border-[var(--border-color)] bg-[var(--sidebar-bg)] transition-[width] duration-200 md:block"
            style={{ width: collapsed ? 60 : 232 }}
          >
            <SidebarContent collapsed={collapsed} onToggle={toggle} />
          </aside>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              side="left"
              className="w-[264px] max-w-[85vw] gap-0 bg-[var(--sidebar-bg)] p-0"
              showCloseButton={false}
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <Header />
            <main className="relative min-h-0 flex-1 overflow-y-auto p-2 sm:p-3 md:p-4">
              <div className="min-h-full min-w-0 rounded-xl border border-[var(--border-color)] bg-white px-4 py-5 pb-20 sm:px-5 sm:py-6 md:px-7">
                {page}
              </div>
              {walkthrough && s.isAdmin && connected && <Walkthrough />}
            </main>
          </div>
        </div>

        <AccountDialog
          tab={accountTab}
          onClose={() => setAccountTab(null)}
          onInviteClick={() => setInviteOpen(true)}
        />

        {s.demo ? (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogContent className="w-[95vw] sm:max-w-lg">
              <DialogHeader className="text-left">
                <DialogTitle>Invites</DialogTitle>
                <DialogDescription>Invite people to your organization on ibl.ai.</DialogDescription>
              </DialogHeader>
              <DemoNotice what="invites" />
            </DialogContent>
          </Dialog>
        ) : (
          <InviteUserDialog
            tenant={s.tenantKey}
            isOpen={inviteOpen}
            onClose={() => setInviteOpen(false)}
            hasManageUsersPermission
          />
        )}
      </TooltipProvider>
    </ShellContext.Provider>
  );
}
