/**
 * Tenant resolution for ibl.ai apps.
 *
 * Priority:
 *   1. NEXT_PUBLIC_MAIN_TENANT_KEY env var — when it names a real platform
 *   2. tenant localStorage — the SDK's own key, written by sign-in and a platform switch
 */

import config from "@/lib/iblai/config";

const PLACEHOLDER_PLATFORMS = new Set([
  "your-main-platform",
  "your-platform",
  "your-tenant",
  "your-tenant-key",
  "test-tenant",
  "main",
  "",
]);

export function resolveAppTenant(): string {
  if (typeof window === "undefined") return "";
  const envTenant = config.mainTenantKey();
  if (envTenant && !PLACEHOLDER_PLATFORMS.has(envTenant)) return envTenant;
  return localStorage.getItem("tenant") ?? "";
}

export function checkTenantMismatch(): boolean {
  if (typeof window === "undefined") return false;
  const appTenant = resolveAppTenant();
  const sdkTenant = localStorage.getItem("tenant") ?? "";
  if (appTenant && sdkTenant && sdkTenant !== appTenant) {
    import("./auth-utils").then(({ redirectToAuthSpa }) => {
      redirectToAuthSpa(undefined, appTenant, false, false);
    });
    return true;
  }
  return false;
}
