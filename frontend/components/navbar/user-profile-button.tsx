"use client";

import { useEffect, useState } from "react";
import { UserProfileDropdown } from "@iblai/iblai-js/web-containers/next";
import config from "@/lib/iblai/config";

interface UserProfileButtonProps {
  username?: string;
  isAdmin: boolean;
  tenantKey: string;
  currentTenant?: any;
  userTenants?: any[];
  authURL: string;
  onLogout: () => void;
  onTenantChange: (newTenantKey: string) => void;
  onAccountDeleted?: () => void;
}

export function UserProfileButton({
  username = "",
  isAdmin,
  tenantKey,
  currentTenant,
  userTenants = [],
  authURL,
  onLogout,
  onTenantChange,
  onAccountDeleted,
}: UserProfileButtonProps) {
  const [email, setEmail] = useState("");
  const [mainKey, setMainKey] = useState("");

  useEffect(() => {
    setMainKey(config.mainTenantKey());
    try {
      const raw = localStorage.getItem("userData");
      if (raw) {
        const parsed = JSON.parse(raw);
        setEmail(parsed.email ?? parsed.user_email ?? "");
      }
    } catch {}
  }, []);

  return (
    <UserProfileDropdown
      email={email}
      mainPlatformKey={mainKey}
      username={username}
      userIsAdmin={isAdmin}
      userIsStudent={false}
      tenantKey={tenantKey}
      currentTenant={currentTenant}
      userTenants={userTenants}
      showProfileTab={true}
      showAccountTab={false}
      showTenantSwitcher={isAdmin}
      showHelpLink={false}
      showLogoutButton={true}
      showLearnerModeSwitch={false}
      currentPlan=""
      authURL={authURL}
      onLogout={onLogout}
      onTenantChange={onTenantChange}
      onTenantUpdate={() => {}}
      onAccountDeleted={onAccountDeleted ?? (() => {})}
    />
  );
}
