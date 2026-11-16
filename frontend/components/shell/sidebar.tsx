"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Blocks,
  BookOpen,
  Bot,
  Box,
  Code,
  Database,
  FileCog,
  KeyRound,
  LayoutDashboard,
  Mail,
  PanelLeft,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Shield,
  Users,
  Waypoints,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { label: string; href: string; icon: LucideIcon; count?: number | string };

// Mirrors iblai/ontology frontend/components/shell/nav-config.ts groups.
const groups: Item[][] = [
  [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Map", href: "/map", icon: Waypoints },
  ],
  [
    { label: "Systems", href: "/systems", icon: Database, count: 4 },
    { label: "Catalog", href: "/catalog", icon: Blocks, count: 109 },
    { label: "Compilation", href: "/sync", icon: RefreshCw },
  ],
  [
    { label: "Ontology", href: "/ontology", icon: Box, count: 14 },
    { label: "MCP Gateway", href: "/mcp", icon: Server, count: 31 },
    { label: "Roles", href: "/roles", icon: Shield, count: 5 },
    { label: "Access", href: "/access", icon: Workflow },
    { label: "Agents", href: "/agents", icon: Bot, count: 4 },
    { label: "Config", href: "/config", icon: FileCog },
  ],
];

const bottom: Item[] = [
  { label: "Notifications", href: "#", icon: Bell },
  { label: "Invites", href: "#", icon: Mail },
  { label: "Management", href: "#", icon: Users },
  { label: "API", href: "#", icon: Code },
  { label: "Secrets", href: "#", icon: KeyRound },
  { label: "Advanced", href: "#", icon: Settings },
  { label: "Support", href: "#", icon: BookOpen },
];

function NavRow({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex h-[34px] w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-[var(--sidebar-foreground)] hover:bg-[var(--hover-bg)]",
        active && "bg-[var(--accent-color)] text-[var(--primary-color)] hover:bg-[var(--accent-color)]"
      )}
    >
      <Icon className={cn("size-4 text-gray-500", active && "text-[var(--primary-color)]")} />
      <span className="truncate">{item.label}</span>
      {item.count !== undefined && (
        <span
          className={cn(
            "ml-auto rounded-full bg-[var(--hover-bg)] px-1.5 text-[11px] text-muted-foreground",
            active && "bg-[rgba(0,88,204,0.12)] text-[var(--primary-color)]"
          )}
        >
          {item.count}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const isActive = (href: string) => href !== "#" && (pathname === href || pathname.startsWith(href + "/"));

  return (
    <aside className="hidden h-full w-[232px] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--sidebar-bg)] md:flex">
      <div className="flex h-14 items-center justify-between pr-2.5 pl-[18px]">
        <Link href="/dashboard" className="flex items-center" aria-label="ibl.ai home">
          <Image src="/iblai-logo.png" alt="ibl.ai" width={800} height={339} className="h-7 w-auto" priority />
        </Link>
        <button
          type="button"
          className="grid size-[30px] place-items-center rounded-md text-gray-500 hover:bg-[var(--hover-bg)]"
          aria-label="Collapse sidebar"
        >
          <PanelLeft className="size-4" />
        </button>
      </div>

      <Link
        href="/systems"
        className="mx-2.5 mt-2 mb-1.5 flex h-[34px] items-center gap-2 rounded-md border border-[var(--border-color)] bg-white px-2.5 text-[13px] text-gray-600 hover:bg-[var(--hover-bg)]"
      >
        <Plus className="size-4" />
        New System
      </Link>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-2" aria-label="Console">
        {groups.map((g, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="my-2 h-px bg-[var(--border-color)]" />}
            {g.map((item) => (
              <NavRow key={item.label} item={item} active={isActive(item.href)} />
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--border-color)] px-2.5 pt-2 pb-3">
        {bottom.map((item) => (
          <NavRow key={item.label} item={item} active={false} />
        ))}
      </div>
    </aside>
  );
}
