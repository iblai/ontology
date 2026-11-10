"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ServerOff, ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/console/empty-state";
import { apiClient, type ApiError } from "@/lib/ontology/api-client";

type Closed = "no_backend" | "bad_backend" | "not_admin";
export type Gate = "checking" | "open" | Closed;

/** Hosted mode: whether this platform has a backend the signed-in member may use. */
export function useBackendGate(hosted: boolean): Gate {
  // The sign-in pages run before there is a token to ask with.
  const signingIn = usePathname()?.startsWith("/sso-login") ?? false;
  const [gate, setGate] = useState<Gate>(hosted ? "checking" : "open");

  useEffect(() => {
    if (!hosted || signingIn) return;
    apiClient.counts().then(
      () => setGate("open"),
      (e: ApiError) => {
        if (e.status === 403) setGate("not_admin");
        else if (e.status === 404 && e.message.includes("bad_backend")) setGate("bad_backend");
        else if (e.status === 404 && e.message.includes("no_backend")) setGate("no_backend");
        // Anything else (a backend that is down, a token that expired) is the pages' to show.
        else setGate("open");
      },
    );
  }, [hosted, signingIn]);

  return signingIn ? "open" : gate;
}

/** The one notice a platform without a usable backend, or a member who is not its admin, gets. */
export function BackendNotice({ gate }: { gate: Closed }) {
  const t = useTranslations("shell.gate");
  return (
    <EmptyState
      icon={gate === "not_admin" ? ShieldAlert : ServerOff}
      title={t(gate)}
      hint={t(`${gate}Hint`)}
      className="mx-auto mt-16 max-w-xl"
    />
  );
}
