"use client";

import { Suspense } from "react";
import { SsoLogin } from "@iblai/iblai-js/web-containers/next";

/**
 * SSO Login Complete page — kept OUTSIDE the IblaiProviders tree (in the
 * (auth) route group) so AuthProvider does not redirect to login before
 * the callback can store tokens.
 */
export default function SsoLoginCompletePage() {
  return (
    <Suspense fallback={<div>Completing login…</div>}>
      <SsoLogin
        localStorageKeys={{
          CURRENT_TENANT: "current_tenant",
          USER_DATA: "userData",
          TENANTS: "tenants",
          AXD_TOKEN: "axd_token",
          AXD_TOKEN_EXPIRES: "axd_token_expires",
          DM_TOKEN: "dm_token",
          DM_TOKEN_EXPIRES: "dm_token_expires",
          EDX_TOKEN_KEY: "edx_jwt_token",
        }}
        redirectPathKey="redirectTo"
        defaultRedirectPath="/"
      />
    </Suspense>
  );
}
