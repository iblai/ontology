"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { CreditBalanceWidget } from "./credit-balance-widget";
import { UserProfileButton } from "./user-profile-button";
import { NotificationDropdown } from "@iblai/iblai-js/web-containers";

interface NavBarProps {
  showHamburger?: boolean;
  tenantKey: string;
  username?: string;
  isAdmin: boolean;
  currentTenant?: any;
  userTenants?: any[];
  authURL: string;
  onLogout: () => void;
  onTenantChange: (key: string) => void;
  showCreditBalance?: boolean;
  showNotifications?: boolean;
  showProfileDropdown?: boolean;
}

export function NavBar({
  showHamburger = false,
  tenantKey,
  username,
  isAdmin,
  currentTenant,
  userTenants,
  authURL,
  onLogout,
  onTenantChange,
  showCreditBalance = true,
  showNotifications = true,
  showProfileDropdown = true,
}: NavBarProps) {
  const router = useRouter();
  const { toggleSidebar } = useSidebar();

  const handleViewNotifications = useCallback(
    (notificationId?: string) => router.push(`/notifications/${notificationId ?? ""}`),
    [router],
  );

  return (
    <header className="h-16 flex-shrink-0 border-b border-[var(--border-color)] bg-[var(--navbar-bg,#fff)] md:h-20">
      <div className="flex h-full items-center justify-between px-4 sm:px-6 md:px-6 lg:px-8">
        {/* Left: hamburger (mobile only) to open the portal sidebar */}
        <div className="flex h-full items-center">
          {showHamburger && (
            <button
              type="button"
              onClick={toggleSidebar}
              className="mr-3 inline-flex items-center justify-center rounded-md text-[var(--navbar-text,var(--text-secondary))] hover:bg-[var(--navbar-hover-bg,var(--hover-bg))] hover:text-[var(--navbar-hover-text,var(--text-primary))] focus:ring-2 focus:ring-[var(--primary-color)] focus:outline-none focus:ring-inset md:hidden"
              aria-label="Toggle sidebar"
            >
              <Menu className="size-6" />
            </button>
          )}
        </div>

        {/* Right: credit balance + notifications + profile */}
        <div className="flex items-center space-x-4">
          {showCreditBalance && <CreditBalanceWidget />}
          {showNotifications && (
            <NotificationDropdown
              org={tenantKey}
              userId={username ?? ""}
              isAdmin={isAdmin}
              onViewNotifications={handleViewNotifications}
            />
          )}
          {showProfileDropdown && (
            <div className="relative">
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
          )}
        </div>
      </div>
    </header>
  );
}
