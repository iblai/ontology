"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/console/empty-state";
import { SectionHeader } from "@/components/console/section-header";
import { ConnectBackend } from "@/components/shell/connect-backend";
import { apiClient, type ApiError } from "@/lib/ontology/api-client";

type Closed = "no_backend" | "no_backend_here" | "bad_backend" | "not_admin";
export type Gate = "checking" | "open" | Closed;

/** With a backend (not the demo): whether there is one the signed-in member may use. */
export function useBackendGate(live: boolean): Gate {
  // The sign-in pages run before there is a token to ask with.
  const signingIn = usePathname()?.startsWith("/sso-login") ?? false;
  const [gate, setGate] = useState<Gate>(live ? "checking" : "open");

  useEffect(() => {
    if (!live || signingIn) return;
    apiClient.counts().then(
      () => setGate("open"),
      (e: ApiError) => {
        if (e.status === 403) setGate("not_admin");
        else if (e.status === 404 && e.message.includes("bad_backend")) setGate("bad_backend");
        // The longer name first: the shorter one is its start.
        else if (e.status === 404 && e.message.includes("no_backend_here"))
          setGate("no_backend_here");
        else if (e.status === 404 && e.message.includes("no_backend")) setGate("no_backend");
        // Anything else (a backend that is down, a token that expired) is the pages' to show.
        else setGate("open");
      },
    );
  }, [live, signingIn]);

  return signingIn ? "open" : gate;
}

/** A platform without a usable backend connects one here; a member who is not its admin gets a notice. */
export function BackendNotice({ gate }: { gate: Closed }) {
  const t = useTranslations("shell.gate");
  if (gate === "not_admin")
    return (
      <EmptyState
        icon={ShieldAlert}
        title={t(gate)}
        hint={t(`${gate}Hint`)}
        className="mx-auto mt-16 max-w-xl"
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title={t(gate)} subtitle={t(`${gate}Hint`)} />
      {/* Loaded again, so every part of the console asks the backend that now answers. */}
      <ConnectBackend onConnected={() => window.location.reload()} />
    </div>
  );
}
