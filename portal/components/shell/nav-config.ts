import {
  BookOpen,
  Bell,
  CalendarCheck,
  ClipboardCheck,
  CreditCard,
  Database,
  FileText,
  LayoutDashboard,
  Mail,
  School,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/types";

export interface NavItem {
  id: string;
  /** Key under the `nav` i18n namespace. */
  labelKey: string;
  icon: LucideIcon;
  href: string;
  exact?: boolean;
  roles: Role[];
}

const ADMINS: Role[] = ["afa_admin", "network_admin", "central_admin"];

export const NAV_ITEMS: NavItem[] = [
  // Parent
  {
    id: "parent-dashboard",
    labelKey: "dashboard",
    icon: LayoutDashboard,
    href: "/parent",
    exact: true,
    roles: ["parent"],
  },
  {
    id: "parent-billing",
    labelKey: "billing",
    icon: CreditCard,
    href: "/parent/billing",
    roles: ["parent"],
  },
  {
    id: "parent-documents",
    labelKey: "documents",
    icon: FileText,
    href: "/parent/documents",
    roles: ["parent"],
  },
  {
    id: "parent-notifications",
    labelKey: "notifications",
    icon: Bell,
    href: "/parent/notifications",
    roles: ["parent"],
  },
  // Student
  {
    id: "student-dashboard",
    labelKey: "dashboard",
    icon: LayoutDashboard,
    href: "/student",
    exact: true,
    roles: ["student"],
  },
  // Admin
  {
    id: "admin-dashboard",
    labelKey: "dashboard",
    icon: LayoutDashboard,
    href: "/admin",
    exact: true,
    roles: [...ADMINS, "finance_admin"],
  },
  {
    id: "admin-applications",
    labelKey: "applications",
    icon: FileText,
    href: "/admin/applications",
    roles: ADMINS,
  },
  {
    id: "admin-interviews",
    labelKey: "interviews",
    icon: CalendarCheck,
    href: "/admin/interviews",
    roles: ["network_admin", "central_admin"],
  },
  {
    id: "admin-billing",
    labelKey: "billing",
    icon: CreditCard,
    href: "/admin/billing",
    roles: [...ADMINS, "finance_admin"],
  },
  {
    id: "admin-placement",
    labelKey: "placement",
    icon: ClipboardCheck,
    href: "/admin/placement",
    roles: ADMINS,
  },
  {
    id: "admin-courses",
    labelKey: "courses",
    icon: BookOpen,
    href: "/admin/courses",
    roles: ADMINS,
  },
  { id: "admin-sis", labelKey: "sis", icon: Database, href: "/admin/sis", roles: ADMINS },
  {
    id: "admin-schools",
    labelKey: "schools",
    icon: School,
    href: "/admin/schools",
    roles: ["central_admin"],
  },
  {
    id: "admin-communications",
    labelKey: "communications",
    icon: Mail,
    href: "/admin/communications",
    roles: ADMINS,
  },
];

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
