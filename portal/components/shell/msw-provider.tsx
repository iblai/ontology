"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function MswProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(true);

  useEffect(() => {
    async function start() {
      try {
        const { setupWorker } = await import("msw/browser");
        const { handlers } = await import("@/mocks/handlers");
        await setupWorker(...handlers).start({ onUnhandledRequest: "bypass" });
      } catch (e) {
        console.warn("[MSW] Failed to start mock service worker:", e);
      }
      setReady(true);
    }
    start();
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
