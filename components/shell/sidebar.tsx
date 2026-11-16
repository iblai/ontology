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
import { useCounts } from "@/lib/data";
import { useSession } from "@/lib/iblai/session";
import type { CountsView } from "@/lib/view/types";
import { useShell, type AccountTab } from "./shell-context";

type NavItem = { label: string; href: string; icon: LucideIcon; count?: keyof CountsView };

// Mirrors iblai/ontology frontend/components/shell/nav-config.ts groups.
const groups: NavItem[][] = [
  [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { label: "Map", href: "/map", icon: Waypoints },
  ],
  [
    { label: "Systems", href: "/systems", icon: Database, count: "systems" },
    { label: "Catalog", href: "/catalog", icon: Blocks, count: "catalog" },
    { label: "Compilation", href: "/sync", icon: RefreshCw },
  ],
  [
    { label: "Ontology", href: "/ontology", icon: Box, count: "ontology" },
    { label: "MCP Gateway", href: "/mcp", icon: Server, count: "gateway" },
    { label: "Roles", href: "/roles", icon: Shield, count: "roles" },
    { label: "Access", href: "/access", icon: Workflow },
    { label: "Agents", href: "/agents", icon: Bot, count: "agents" },
    { label: "Config", href: "/config", icon: FileCog },
  ],
];

type FooterAction =
  | { id: string; label: string; icon: LucideIcon; kind: "route"; href: string; admin?: boolean }
  | { id: string; label: string; icon: LucideIcon; kind: "account"; tab: AccountTab; admin: true }
  | { id: string; label: string; icon: LucideIcon; kind: "invite"; admin: true }
  | {
      id: string;
      label: string;
      icon: LucideIcon;
      kind: "external";
      href: string;
      admin?: boolean;
    };

// Same items and order as the os.ibl.ai footer; admin items follow the live
// User/Admin switch, exactly as the OS does.
const footer: FooterAction[] = [
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    kind: "route",
    href: "/notifications",
  },
  { id: "invites", label: "Invites", icon: Mail, kind: "invite", admin: true },
  {
    id: "management",
    label: "Management",
    icon: Users,
    kind: "account",
    tab: "management",
    admin: true,
  },
  { id: "api", label: "API", icon: Code, kind: "account", tab: "api", admin: true },
  { id: "secrets", label: "Secrets", icon: KeyRound, kind: "account", tab: "secrets", admin: true },
  {
    id: "advanced",
    label: "Advanced",
    icon: Settings,
    kind: "account",
    tab: "advanced",
    admin: true,
  },
  {
    id: "support",
    label: "Support",
    icon: BookOpen,
    kind: "external",
    href: "https://docs.ibl.ai",
  },
];

const rowBase =
  "flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-md text-sm text-[var(--sidebar-foreground)] hover:bg-[var(--hover-bg)] focus-visible:outline-2 focus-visible:outline-[var(--primary-color)]";

function Count({ n, active }: { n: number; active: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-full bg-[var(--hover-bg)] px-1.5 text-[11px] text-muted-foreground tabular-nums",
        active && "bg-[rgba(0,88,204,0.12)] text-[var(--primary-color)]",
      )}
    >
      {n}
    </span>
  );
}

export function SidebarContent({
  collapsed = false,
  onToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "/";
  const { liveAdmin } = useSession();
  const shell = useShell();
  const counts = useCounts();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const row = (active: boolean) =>
    cn(
      rowBase,
      collapsed ? "justify-center px-0" : "px-2.5",
      active &&
        "bg-[var(--accent-color)] text-[var(--primary-color)] hover:bg-[var(--accent-color)]",
    );
  const icon = (active: boolean) =>
    cn("size-4 shrink-0 text-gray-500", active && "text-[var(--primary-color)]");

  const runFooter = (a: FooterAction) => {
    onNavigate?.();
    if (a.kind === "account") shell.openAccount(a.tab);
    if (a.kind === "invite") shell.openInvite();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center",
          collapsed ? "justify-center" : "justify-between pr-2.5 pl-[18px]",
        )}
      >
        {!collapsed && (
          <Link
            href="/dashboard"
            className="flex items-center"
            aria-label="ibl.ai home"
            onClick={onNavigate}
          >
            <Image
              src="/iblai-logo.png"
              alt="ibl.ai"
              width={800}
              height={339}
              className="h-7 w-auto"
              priority
            />
          </Link>
        )}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="grid size-[30px] place-items-center rounded-md text-gray-500 hover:bg-[var(--hover-bg)]"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <PanelLeft className="size-4" />
          </button>
        )}
      </div>

      <div className={cn("shrink-0", collapsed ? "px-2.5 pb-1.5" : "mx-2.5 mt-2 mb-1.5")}>
        <Link
          href="/systems"
          onClick={onNavigate}
          title={collapsed ? "New System" : undefined}
          aria-label="New System"
          className={cn(
            "flex h-[34px] items-center gap-2 rounded-md border border-[var(--border-color)] bg-white text-[13px] text-gray-600 hover:bg-[var(--hover-bg)]",
            collapsed ? "justify-center" : "px-2.5",
          )}
        >
          <Plus className="size-4 shrink-0" />
          {!collapsed && "New System"}
        </Link>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2" aria-label="Console">
        {groups.map((g, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="my-2 h-px bg-[var(--border-color)]" />}
            {g.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              const n = item.count ? counts[item.count] : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={row(active)}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className={icon(active)} />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && n !== null && <Count n={n} active={active} />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div
        className="shrink-0 border-t border-[var(--border-color)] px-2.5 pt-2 pb-3"
        data-testid="sidebar-footer"
      >
        {footer
          .filter((a) => !a.admin || liveAdmin)
          .map((a) => {
            const Icon = a.icon;
            const active = a.kind === "route" && isActive(a.href);
            const content = (
              <>
                <Icon className={icon(active)} />
                {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{a.label}</span>}
              </>
            );
            const label = collapsed ? a.label : undefined;
            if (a.kind === "route")
              return (
                <Link
                  key={a.id}
                  href={a.href}
                  onClick={onNavigate}
                  className={row(active)}
                  title={label}
                  aria-label={label}
                >
                  {content}
                </Link>
              );
            if (a.kind === "external")
              return (
                <a
                  key={a.id}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={row(false)}
                  title={label}
                  aria-label={label}
                >
                  {content}
                </a>
              );
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => runFooter(a)}
                className={row(false)}
                title={label}
                aria-label={label}
              >
                {content}
              </button>
            );
          })}
      </div>
    </div>
  );
}
