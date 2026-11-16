"use client";

/**
 * The signed-in ibl.ai session as the console needs it, read from the storage
 * keys SsoLogin / TenantProvider write (the same keys iblai/os uses — see
 * docs/auth.md). Nothing here is fetched or persisted by the console itself.
 *
 * Demo mode (NEXT_PUBLIC_DEMO=1) skips SSO and serves a fixed session so the
 * UI can be reviewed and screenshotted without an ibl.ai account. SDK-backed
 * surfaces render a sign-in notice in that mode instead of calling ibl.ai.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import config from "./config";
import { readTenants, resolveAppTenant, type TenantEntry } from "./tenant";

export const isDemo = () => process.env.NEXT_PUBLIC_DEMO === "1";

export type Session = {
  demo: boolean;
  tenantKey: string;
  tenantName: string;
  tenants: TenantEntry[];
  currentTenant?: TenantEntry;
  username: string;
  email: string;
  displayName: string;
  initials: string;
  isAdmin: boolean;
  mainPlatformKey: string;
  authUrl: string;
};

type Ctx = Session & {
  adminMode: boolean;
  setAdminMode: (on: boolean) => void;
  liveAdmin: boolean;
};

const SessionContext = createContext<Ctx | null>(null);

function initialsOf(name: string) {
  const parts = name
    .replace(/[@._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase() || "?";
}

function tenantLabel(t?: TenantEntry, fallback = "") {
  const name = (t?.platform_name ?? t?.name ?? t?.org ?? "") as string;
  return name || fallback;
}

function readSession(): Session {
  const base = { mainPlatformKey: config.mainTenantKey(), authUrl: config.authUrl() };
  if (isDemo()) {
    const tenants: TenantEntry[] = [
      { key: "university", platform_name: "University", is_admin: true },
      { key: "university-sandbox", platform_name: "University Sandbox", is_admin: true },
    ];
    return {
      ...base,
      demo: true,
      tenantKey: "university",
      tenantName: "University",
      tenants,
      currentTenant: tenants[0],
      username: "demo-admin",
      email: "admin@university.edu",
      displayName: "Demo Admin",
      initials: "DA",
      isAdmin: true,
    };
  }
  let username = "";
  let email = "";
  let displayName = "";
  try {
    const raw = localStorage.getItem("userData");
    if (raw) {
      const u = JSON.parse(raw);
      username = u.user_nicename ?? u.username ?? "";
      email = u.user_email ?? u.email ?? "";
      displayName = u.user_display_name ?? u.name ?? u.full_name ?? username;
    }
  } catch {
    /* storage unavailable */
  }
  const tenantKey = resolveAppTenant();
  const tenants = readTenants();
  const currentTenant = tenants.find((t) => t.key === tenantKey);
  return {
    ...base,
    demo: false,
    tenantKey,
    tenantName: tenantLabel(currentTenant, tenantKey),
    tenants,
    currentTenant,
    username,
    email,
    displayName: displayName || email || username,
    initials: initialsOf(displayName || email || username),
    isAdmin: !!currentTenant?.is_admin,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // Providers above only render children once storage holds the session.
  const [session] = useState(readSession);
  const [adminMode, setAdminMode] = useState(true);
  const value = useMemo<Ctx>(
    () => ({ ...session, adminMode, setAdminMode, liveAdmin: session.isAdmin && adminMode }),
    [session, adminMode],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

export { tenantLabel };
