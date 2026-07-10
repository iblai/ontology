import { LayoutDashboard, Database, Network, type LucideIcon } from "lucide-react";

/** A leaf link inside a sidebar group. `labelKey` resolves under the `nav.*` i18n namespace. */
export interface NavItem {
  href: string;
  labelKey: string;
}

/** A PlatformSidebar `menu` section: an icon + label header (accordion on desktop,
 *  icon in the collapsed rail) over its leaf links. `labelKey` resolves under `nav.*`. */
export interface NavGroup {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  items: NavItem[];
}

/** The console nav, grouped into PlatformSidebar sections. Section icons show in
 *  the collapsed rail; active state highlights the matching leaf (by `href`). */
export const PLATFORM_SIDEBAR_SECTIONS: NavGroup[] = [
  {
    id: "overview",
    labelKey: "groupOverview",
    icon: LayoutDashboard,
    items: [{ href: "/dashboard", labelKey: "dashboard" }],
  },
  {
    id: "sources",
    labelKey: "groupSources",
    icon: Database,
    items: [
      { href: "/services", labelKey: "servicesList" },
      { href: "/catalog", labelKey: "catalog" },
      { href: "/sync", labelKey: "sync" },
    ],
  },
  {
    id: "gateway",
    labelKey: "groupGateway",
    icon: Network,
    items: [
      { href: "/mcp", labelKey: "mcpGateway" },
      { href: "/config", labelKey: "config" },
    ],
  },
];
