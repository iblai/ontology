"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  PLATFORM_SIDEBAR_NAV_MUTED,
  PlatformSidebarCollapsedLabelFlyout,
  type PlatformSidebarNavIcon,
} from "@iblai/iblai-js/web-containers/next";
import { cn } from "@/lib/utils";

/**
 * A flat sidebar row, the SIS's `NavRow` as a link: an icon with a label flyout in the
 * collapsed rail, icon + label + count when expanded.
 */
export function NavRow({
  collapsed,
  icon: Icon,
  label,
  href,
  count,
  onAfterNav,
}: {
  collapsed: boolean;
  icon: PlatformSidebarNavIcon;
  label: string;
  href: string;
  count?: number;
  onAfterNav: () => void;
}) {
  const pathname = usePathname() ?? "";
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const color = active ? "#1e40af" : PLATFORM_SIDEBAR_NAV_MUTED;

  if (collapsed) {
    return (
      <PlatformSidebarCollapsedLabelFlyout label={label}>
        <Link
          href={href}
          onClick={onAfterNav}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] transition-colors outline-none hover:bg-[#f0f0f0] focus-visible:ring-2 focus-visible:ring-[#c4c4c8] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fafafa]",
            active && "bg-[#eef6fc]",
          )}
        >
          <Icon className="size-4 shrink-0" style={{ color }} strokeWidth={1.5} />
        </Link>
      </PlatformSidebarCollapsedLabelFlyout>
    );
  }

  return (
    <Link
      href={href}
      onClick={onAfterNav}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-[14px] font-normal transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#cfe8fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fafafa]",
        active ? "bg-[#eef6fc] text-[#1e40af]" : "text-[#5f5f61] hover:bg-[#f4f4f4]",
      )}
    >
      <Icon className="size-4 shrink-0" style={{ color }} strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span
          className={cn("text-xs tabular-nums", active ? "text-[#1e40af]/70" : "text-[#8a8b8f]")}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
