"use client";

import { useEffect, useState } from "react";
import { CreditBalance } from "@iblai/iblai-js/web-containers";
import config from "@/lib/iblai/config";
import { resolveAppTenant } from "@/lib/iblai/tenant";

export function CreditBalanceWidget() {
  const [tenant, setTenant] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");

  useEffect(() => {
    setTenant(resolveAppTenant());
    try {
      const raw = localStorage.getItem("userData");
      if (raw) {
        const parsed = JSON.parse(raw);
        setUsername(parsed.user_nicename ?? parsed.username ?? "");
        setEmail(parsed.email ?? parsed.user_email ?? "");
      }
    } catch {}
    try {
      const raw = localStorage.getItem("current_tenant");
      if (raw) {
        const parsed = JSON.parse(raw);
        setEnabled(Boolean(parsed?.show_paywall));
      }
    } catch {}
    setRedirectUrl(window.location.href);
  }, []);

  if (!tenant || !username) return null;

  return (
    <CreditBalance
      tenant={tenant}
      username={username}
      mainPlatformKey={config.mainTenantKey()}
      currentUserEmail={email}
      redirectUrl={redirectUrl}
      enabled={enabled}
    />
  );
}
