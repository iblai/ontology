"use client";

/**
 * ibl.ai provider chain, from the iblai/vibe starter (/iblai-vibe-auth):
 * Redux store → AuthProvider (SSO redirect, token checks, cross-tab sync) →
 * TenantProvider (platform membership and re-auth). Multi-platform: the
 * platform is the one the sign-in is for (lib/iblai/tenant.ts).
 *
 * The SSO callback (app/(auth)/sso-login-complete) lives OUTSIDE this chain;
 * wrapping it would make AuthProvider redirect before the tokens are stored.
 */

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { usePathname } from "next/navigation";
import { initializeDataLayer, type TokenResponse } from "@iblai/iblai-js/data-layer";
import {
  AuthProvider,
  TenantProvider,
  clearCurrentTenantCookie,
  isTenantSwitchInProgress,
} from "@iblai/iblai-js/web-utils";
import { Toaster } from "sonner";

import { iblaiStore } from "@/store/iblai-store";
import { LocalStorageService } from "@/lib/iblai/storage-service";
import config from "@/lib/iblai/config";
import { currentTenantKey, type TenantEntry } from "@/lib/iblai/tenant";
import { redirectToAuthSpa, switchPlatform } from "@/lib/iblai/auth-utils";
import { isDemo } from "@/lib/iblai/session";
import { RadixPointerEventsGuard } from "@/components/radix-pointer-events-guard";
import { LoadingScreen } from "@/components/loading-screen";

const storageService = LocalStorageService.getInstance();
const noopSubscribe = () => () => {};

/** Routes that do not require a session. */
const PUBLIC_ROUTES = new Map<RegExp, () => Promise<boolean>>([
  [new RegExp("^/sso-login"), async () => false],
]);

/** One retry of the sign-in without a platform, when the stored one refused the user. */
const REAUTH_WITHOUT_PLATFORM = "ontology_reauth_without_platform";

export function IblaiProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const demo = isDemo();
  const [authFailure, setAuthFailure] = useState("");

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

  const tenantKey = mounted ? currentTenantKey() : "";
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

  if (authFailure) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p role="alert" className="text-destructive max-w-md text-sm">
          You do not have access to this platform. {authFailure}
        </p>
      </div>
    );
  }

  // Every port on localhost shares one cookie jar, and *.iblai.me's parent-domain cookies belong to other apps.
  const enableStorageSync = !/^(localhost|127\.0\.0\.1|\[::1\])$|\.iblai\.me$/.test(
    window.location.hostname,
  );

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
        enableStorageSync={enableStorageSync}
        fallback={LOADING}
      >
        <TenantProvider
          skip={isSsoRoute}
          currentTenant={tenantKey}
          requestedTenant={tenantKey}
          saveCurrentTenant={(t: TenantEntry) => {
            localStorage.setItem("current_tenant", JSON.stringify(t));
            localStorage.setItem("tenant", t.key);
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
          onAuthFailure={(reason: string) => {
            console.error("[TenantProvider] Auth failure:", reason);
            // The stored platform refused the user: sign in again with none, once per tab.
            if (!sessionStorage.getItem(REAUTH_WITHOUT_PLATFORM)) {
              sessionStorage.setItem(REAUTH_WITHOUT_PLATFORM, "1");
              localStorage.removeItem("tenant");
              localStorage.removeItem("current_tenant");
              clearCurrentTenantCookie();
              void redirectToAuthSpa(undefined, undefined, true);
              return;
            }
            setAuthFailure(reason);
          }}
          onTenantMismatch={() => {
            // A tab mid-switch sees the old platform; do not ping-pong.
            if (isTenantSwitchInProgress()) return;
            window.location.href = "/";
          }}
          handleTenantSwitch={(tenant, saveRedirect) => switchPlatform(tenant, saveRedirect)}
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
