/**
 * The platform the console works in: the one the sign-in is for, as the SDK keeps it in
 * `current_tenant` (an object) and `tenant` (its key). The console pins no platform and keeps
 * no copy of its own.
 */

export type TenantEntry = {
  key: string;
  is_admin?: boolean;
  org?: string;
  platform_name?: string;
  [k: string]: unknown;
};

/** The SDK's record of the platform this session is in, or null when it holds none yet. */
export function readCurrentTenant(): TenantEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem("current_tenant") ?? "null");
    const key = (parsed as { key?: unknown } | null)?.key;
    return typeof key === "string" && key ? (parsed as TenantEntry) : null;
  } catch {
    return null; // an older app's bare key
  }
}

/** The key of the platform this session is signed in to; "" when signed out. */
export function currentTenantKey(): string {
  if (typeof window === "undefined") return "";
  // A sign-in that just landed has written `tenant` and not yet the record.
  return readCurrentTenant()?.key ?? localStorage.getItem("tenant") ?? "";
}

/** The platforms the sign-in handed the browser (`tenants`), or [] when signed out. */
export function readTenants(): TenantEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem("tenants") ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Whether the signed-in user is an admin of the platform this session is in. */
export function isTenantAdmin(): boolean {
  const key = currentTenantKey();
  return !!(readCurrentTenant() ?? readTenants().find((t) => t.key === key))?.is_admin;
}
