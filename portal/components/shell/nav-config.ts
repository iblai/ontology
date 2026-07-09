import {
  LayoutDashboard,
  Database,
  BookOpen,
  RefreshCw,
  Network,
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
    labelKey: "nav.dashboard",
    items: [{ href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard }],
  },
  {
    labelKey: "nav.services",
    items: [{ href: "/services", labelKey: "nav.servicesList", icon: Database }],
  },
  {
    labelKey: "nav.catalog",
    items: [{ href: "/catalog", labelKey: "nav.catalog", icon: BookOpen }],
  },
  {
    labelKey: "nav.sync",
    items: [{ href: "/sync", labelKey: "nav.sync", icon: RefreshCw }],
  },
  {
    labelKey: "nav.mcp",
    items: [{ href: "/mcp", labelKey: "nav.mcpGateway", icon: Network }],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);;