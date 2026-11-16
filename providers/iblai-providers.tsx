"use client";

/**
 * ibl.ai provider chain, from the iblai/vibe starter (/iblai-vibe-auth):
 * Redux store → AuthProvider (SSO redirect, token checks, cross-tab sync) →
 * TenantProvider (organization membership and re-auth). Single-organization:
 * the org is pinned by NEXT_PUBLIC_MAIN_TENANT_KEY.
 *
 * The SSO callback (app/(auth)/sso-login-complete) lives OUTSIDE this chain;
 * wrapping it would make AuthProvider redirect before the tokens are stored.
 */

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { usePathname } from "next/navigation";
import { initializeDataLayer, type TokenResponse } from "@iblai/iblai-js/data-layer";
import { AuthProvider, TenantProvider } from "@iblai/iblai-js/web-utils";
import { Toaster } from "sonner";

import { iblaiStore } from "@/store/iblai-store";
import { LocalStorageService } from "@/lib/iblai/storage-service";
import config from "@/lib/iblai/config";
import { resolveAppTenant, checkTenantMismatch } from "@/lib/iblai/tenant";
import { redirectToAuthSpa } from "@/lib/iblai/auth-utils";
import { isDemo } from "@/lib/iblai/session";
import { RadixPointerEventsGuard } from "@/components/radix-pointer-events-guard";
import { LoadingScreen } from "@/components/loading-screen";

const storageService = LocalStorageService.getInstance();
const noopSubscribe = () => () => {};

/** Routes that do not require a session. */
const PUBLIC_ROUTES = new Map<RegExp, () => Promise<boolean>>([
  [new RegExp("^/sso-login"), async () => false],
]);

export function IblaiProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const demo = isDemo();

  // Must run before any child renders so RTK Query hooks see the URLs.
  const [isInitialized] = useState(() => {
    if (typeof window === "undefined" || demo) return true;
    try {
      initializeDataLayer(config.dmUrl(), config.lmsUrl(), config.legacyLmsUrl(), storageService, {
        401: () => redirectToAuthSpa(undefined, undefined, true),
      });
    } catch (e) {
      console.error("[ibl.ai] initializeDataLayer failed:", e);
    }
    return true;
  });

  // Gate on a mount flag so server and first client render agree.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const username = useMemo(() => {
    if (typeof window === "undefined") return "";
    try {
      const raw = localStorage.getItem("userData");
      if (raw) return JSON.parse(raw).user_nicename ?? "";
    } catch {
      /* ignore */
    }
    return "";
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read storage once mounted
  }, [mounted]);

  const tenantKey = mounted ? resolveAppTenant() : "";
  const isSsoRoute = pathname?.startsWith("/sso-login") ?? false;
  const LOADING = <LoadingScreen />;

  if (!isInitialized || !mounted) return LOADING;

  if (demo) {
    return (
      <ReduxProvider store={iblaiStore}>
        <Toaster />
        {children}
      </ReduxProvider>
    );
  }

  if (!tenantKey && !isSsoRoute) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p role="alert" className="text-destructive max-w-md text-sm">
          NEXT_PUBLIC_MAIN_TENANT_KEY is not set, is still a placeholder, or is the shared{" "}
          <code>main</code> organization. Put your organization&apos;s key in{" "}
          <code>.env.local</code> (it is listed on {config.authUrl()}/me) and restart.
        </p>
      </div>
    );
  }

  return (
    <ReduxProvider store={iblaiStore}>
      <RadixPointerEventsGuard />
      <Toaster />
      <AuthProvider
        skip={isSsoRoute}
        redirectToAuthSpa={redirectToAuthSpa}
        username={username}
        pathname={pathname ?? "/"}
        storageService={storageService}
        middleware={PUBLIC_ROUTES}
        enableStorageSync
        fallback={LOADING}
      >
        <TenantProvider
          skip={isSsoRoute}
          currentTenant={tenantKey}
          requestedTenant={tenantKey}
          saveCurrentTenant={(t: unknown) => {
            const key = typeof t === "string" ? t : ((t as { key?: string })?.key ?? String(t));
            localStorage.setItem("current_tenant", key);
            localStorage.setItem("tenant", key);
            checkTenantMismatch();
          }}
          saveUserTenants={(t: unknown) => localStorage.setItem("tenants", JSON.stringify(t))}
          saveUserTokens={(tokens: TokenResponse) => {
            if (tokens?.axd_token) {
              localStorage.setItem("axd_token", tokens.axd_token.token);
              localStorage.setItem("axd_token_expires", tokens.axd_token.expires);
            }
            if (tokens?.dm_token) {
              localStorage.setItem("dm_token", tokens.dm_token.token);
              localStorage.setItem("dm_token_expires", tokens.dm_token.expires);
            }
          }}
          saveTenant={(t: string) => localStorage.setItem("tenant", t)}
          onAuthFailure={(reason: string) =>
            console.error("[TenantProvider] Auth failure:", reason)
          }
          handleTenantSwitch={async () =>
            redirectToAuthSpa(undefined, resolveAppTenant(), false, true)
          }
          redirectToAuthSpa={redirectToAuthSpa}
          username={username}
          fallback={LOADING}
        >
          {children}
        </TenantProvider>
      </AuthProvider>
    </ReduxProvider>
  );
}
