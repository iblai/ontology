import {
  LayoutDashboard,
  Database,
  BookOpen,
  RefreshCw,
  Network,
  FileCog,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
}

export interface NavSection {
  labelKey: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: "dashboard",
    items: [{ href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard }],
  },
  {
    labelKey: "services",
    items: [{ href: "/services", labelKey: "servicesList", icon: Database }],
  },
  {
    labelKey: "catalog",
    items: [{ href: "/catalog", labelKey: "catalog", icon: BookOpen }],
  },
  {
    labelKey: "sync",
    items: [{ href: "/sync", labelKey: "sync", icon: RefreshCw }],
  },
  {
    labelKey: "mcp",
    items: [{ href: "/mcp", labelKey: "mcpGateway", icon: Network }],
  },
  {
    labelKey: "config",
    items: [{ href: "/config", labelKey: "config", icon: FileCog }],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);
