"use client";

/**
 * ibl.ai Provider wrapper.
 *
 * Wrap your root layout children with <IblaiProviders> to get:
 *  - Redux store (RTK Query for IBL APIs)
 *  - AuthProvider  (SSO redirect, JWT validation, cross-SPA sync)
 *  - TenantProvider (multi-tenant routing)
 */

import { useMemo, useState, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { usePathname } from "next/navigation";
import { initializeDataLayer } from "@iblai/iblai-js/data-layer";
import { AuthProvider, TenantProvider, updateRbacPermissions } from "@iblai/iblai-js/web-utils";

import { iblaiStore } from "@/store/iblai-store";
import { LocalStorageService } from "@/lib/iblai/storage-service";
import config from "@/lib/iblai/config";
import { resolveAppTenant, checkTenantMismatch } from "@/lib/iblai/tenant";
import { redirectToAuthSpa } from "@/lib/iblai/auth-utils";
import { keepSetupLink } from "@/lib/ontology/install";

const storageService = LocalStorageService.getInstance();

const PUBLIC_ROUTES = new Map<RegExp, () => Promise<boolean>>([
  [new RegExp("^/sso-login"), async () => false],
]);

const LOADING = (
  <div className="flex min-h-screen items-center justify-center">
    <p className="text-sm text-gray-400">Loading...</p>
  </div>
);

export function IblaiProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  const [isInitialized] = useState(() => {
    if (typeof window === "undefined") return false;
    // Before the sign-in redirect below can leave the page: it keeps only the path.
    keepSetupLink();
    try {
      initializeDataLayer(config.dmUrl(), config.lmsUrl(), config.lmsUrl(), storageService, {
        401: () => redirectToAuthSpa(undefined, undefined, true),
      });
    } catch (e) {
      console.error("[ibl.ai] initializeDataLayer failed:", e);
    }
    return true;
  });

  const username = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      const raw = localStorage.getItem("userData");
      if (raw) return JSON.parse(raw).user_nicename ?? "";
    } catch {
      /* ignore */
    }
    return "";
  }, []);

  const tenantKey = useMemo(() => resolveAppTenant(), []);
  const isSsoRoute = pathname?.startsWith("/sso-login") ?? false;
  // Off on localhost, where every port shares one cookie jar and local consoles would fight over it.
  const enableStorageSync =
    typeof window !== "undefined" &&
    !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

  if (!isInitialized) return LOADING;

  return (
    <ReduxProvider store={iblaiStore}>
      <AuthProvider
        skip={isSsoRoute}
        redirectToAuthSpa={redirectToAuthSpa}
        username={username}
        pathname={pathname ?? "/"}
        storageService={storageService}
        middleware={PUBLIC_ROUTES}
        enableStorageSync={enableStorageSync}
        fallback={LOADING}
      >
        <TenantProvider
          skip={isSsoRoute}
          currentTenant={tenantKey}
          requestedTenant={tenantKey}
          saveCurrentTenant={(t: { key: string }) => {
            // The object, as the SDK's cookie holds it: a bare key reads as a change on every sync.
            localStorage.setItem("current_tenant", JSON.stringify(t));
            localStorage.setItem("tenant", t.key);
            checkTenantMismatch();
          }}
          saveUserTenants={(t: unknown) => localStorage.setItem("tenants", JSON.stringify(t))}
          handleTenantSwitch={async () => {
            const tenant = resolveAppTenant();
            redirectToAuthSpa(undefined, tenant, false, true);
          }}
          redirectToAuthSpa={redirectToAuthSpa}
          username={username}
          onLoadPlatformPermissions={(perms) =>
            iblaiStore.dispatch(updateRbacPermissions((perms ?? {}) as never))
          }
          fallback={LOADING}
        >
          {children}
        </TenantProvider>
      </AuthProvider>
    </ReduxProvider>
  );
}
