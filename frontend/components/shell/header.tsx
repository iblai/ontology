"use client";

import { usePathname } from "next/navigation";
import { Bell, Box, ChevronDown, CreditCard, Menu, Network } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/map": "Map",
  "/systems": "Systems",
  "/catalog": "Catalog",
  "/sync": "Compilation",
  "/ontology": "Ontology",
  "/mcp": "MCP Gateway",
  "/roles": "Roles",
  "/access": "Access",
  "/agents": "Agents",
  "/config": "Config",
};


export function Header() {
  const pathname = usePathname() ?? "/";
  const base = "/" + (pathname.split("/")[1] || "dashboard");
  const title = titles[base] ?? "Ontology";

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border-color)] bg-[var(--navbar-bg,#fff)] pr-5 pl-3">
      <button type="button" className="mr-1 rounded-md p-1.5 text-gray-600 hover:bg-[var(--hover-bg)] md:hidden" aria-label="Open sidebar">
        <Menu className="size-5" />
      </button>

      <button type="button" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-[var(--hover-bg)]">
        <Box className="size-4 text-gray-500" />
        Institution
        <ChevronDown className="size-3.5 text-gray-400" />
      </button>
      <span className="hidden text-sm text-gray-400 sm:inline">· {title}</span>

      <div className="flex-1" />

      <div className="mr-3 hidden items-center gap-2 text-sm text-gray-500 md:flex">
        User
        <Switch defaultChecked aria-label="Admin mode" />
        <b className="font-semibold text-gray-900">Admin</b>
      </div>
      <button type="button" className="grid size-[34px] place-items-center rounded-md text-gray-700 hover:bg-[var(--hover-bg)]" title="Systems map">
        <Network className="size-4" />
      </button>
      <button type="button" className="grid size-[34px] place-items-center rounded-md text-gray-700 hover:bg-[var(--hover-bg)]" title="Billing">
        <CreditCard className="size-4" />
      </button>
      <button type="button" className="grid size-[34px] place-items-center rounded-md text-gray-700 hover:bg-[var(--hover-bg)]" title="Notifications">
        <Bell className="size-4" />
      </button>
      <span className="ml-1.5 grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#0ea5e9] to-[#0058cc] text-xs font-semibold text-white">
        MA
      </span>
    </header>
  );
}
