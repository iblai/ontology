import {
  Blocks,
  Boxes,
  CalendarClock,
  Database,
  FileCog,
  LayoutDashboard,
  Plug,
  RefreshCw,
  Server,
  Shield,
  Waypoints,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Which figure a row shows beside its label: a `/counts` field or the catalog size. */
export type NavCount = "services" | "tools" | "roles" | "catalog";

/** A sidebar row. `labelKey` resolves under the `nav.*` i18n namespace. */
export interface NavItem {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  count?: NavCount;
}

/** A sidebar group: a small heading over its rows (a divider in the collapsed rail). */
export interface NavGroup {
  id: string;
  labelKey: string;
  items: NavItem[];
}

/** The console nav: every page is a row, grouped under headings. */
export const PLATFORM_SIDEBAR_SECTIONS: NavGroup[] = [
  {
    id: "overview",
    labelKey: "groupOverview",
    items: [
      { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
      { href: "/map", labelKey: "map", icon: Waypoints },
    ],
  },
  {
    id: "sources",
    labelKey: "groupSources",
    items: [
      { href: "/services", labelKey: "services", icon: Database, count: "services" },
      { href: "/catalog", labelKey: "catalog", icon: Blocks, count: "catalog" },
      { href: "/sync", labelKey: "sync", icon: RefreshCw },
    ],
  },
  {
    id: "gateway",
    labelKey: "groupGateway",
    items: [
      { href: "/mcp", labelKey: "mcpGateway", icon: Server, count: "tools" },
      { href: "/roles", labelKey: "roles", icon: Shield, count: "roles" },
      { href: "/access", labelKey: "access", icon: Workflow },
      { href: "/config", labelKey: "config", icon: FileCog },
    ],
  },
];

/** The top bar's New menu and the palette's Create group; `?new=` opens the page's dialog. `labelKey` resolves under `shell.*`. */
export const CREATE_ACTIONS: { id: string; labelKey: string; href: string; icon: LucideIcon }[] = [
  { id: "service", labelKey: "newService", href: "/services/add", icon: Database },
  { id: "tool", labelKey: "newTool", href: "/mcp?new=tool", icon: Wrench },
  { id: "toolset", labelKey: "newToolset", href: "/mcp?new=toolset", icon: Boxes },
  { id: "source", labelKey: "newSource", href: "/mcp?new=source", icon: Plug },
  { id: "role", labelKey: "newRole", href: "/roles?new=role", icon: Shield },
  { id: "schedule", labelKey: "newSchedule", href: "/sync?new=schedule", icon: CalendarClock },
];

/** A top-bar crumb: a `nav.*` key, or a record name taken from the URL when `raw`. */
export interface Crumb {
  label: string;
  raw?: boolean;
  href?: string;
}

/** Sub-pages with a label of their own; any other second segment is a record name. */
const SUBPAGES: Record<string, string> = {
  "/services/add": "addService",
  "/mcp/playground": "mcpPlayground",
};

/** Pages outside the sidebar, by first segment. */
const OUTSIDE: Record<string, string> = {
  notifications: "notifications",
  account: "account",
  profile: "profile",
};

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** group › page › record for the top bar, from the URL alone. */
export function crumbsFor(pathname: string): Crumb[] {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (!first) return [];
  for (const group of PLATFORM_SIDEBAR_SECTIONS) {
    const item = group.items.find((i) => i.href === `/${first}`);
    if (!item) continue;
    const crumbs: Crumb[] = [{ label: group.labelKey }, { label: item.labelKey, href: item.href }];
    if (second) {
      const sub = SUBPAGES[`/${first}/${second}`];
      crumbs.push(sub ? { label: sub } : { label: decode(second), raw: true });
    }
    return crumbs;
  }
  return Object.hasOwn(OUTSIDE, first) ? [{ label: OUTSIDE[first] }] : [];
}
