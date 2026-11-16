"use client";

import { createContext, useContext } from "react";

export type AccountTab = "management" | "api" | "secrets" | "advanced" | "billing";

export type ShellActions = {
  openAccount: (tab: AccountTab) => void;
  openInvite: () => void;
  openMobileNav: () => void;
};

export const ShellContext = createContext<ShellActions | null>(null);

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside the app shell");
  return ctx;
}
