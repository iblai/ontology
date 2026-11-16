"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Prototype-only guide through the five-step flow. Hide with NEXT_PUBLIC_WALKTHROUGH=0.
const steps = [
  { n: 0, label: "Dashboard", href: "/dashboard" },
  { n: 1, label: "Connect", href: "/systems" },
  { n: 2, label: "Dissect", href: "/map" },
  { n: 3, label: "Model", href: "/ontology" },
  { n: 4, label: "Expose", href: "/mcp/new" },
  { n: 5, label: "Serve", href: "/mcp/institution" },
];

/** Sticks to the bottom of the content column, so it never covers the sidebar. */
export function Walkthrough() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const cur = steps.findIndex((s) => s.href === pathname);

  return (
    <div className="pointer-events-none sticky bottom-3 z-20 -mt-14 flex justify-center px-2">
      <nav
        aria-label="Walkthrough"
        className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-[var(--border-color)] bg-white py-1 pr-1.5 pl-2 shadow-[0_4px_6px_-1px_rgb(0_0_0/0.1),0_2px_4px_-2px_rgb(0_0_0/0.1)] sm:gap-1 sm:pl-3"
      >
        <span className="text-muted-foreground mr-1 hidden text-[11px] whitespace-nowrap xl:inline">
          Walkthrough
        </span>
        {steps.map((s, i) => (
          <Link
            key={s.href}
            href={s.href}
            title={s.label}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 text-xs whitespace-nowrap text-gray-600 hover:bg-[var(--hover-bg)] sm:px-2.5",
              i === cur &&
                "bg-[var(--accent-color)] text-[var(--primary-color)] hover:bg-[var(--accent-color)]",
            )}
          >
            <b
              className={cn(
                "grid size-[18px] place-items-center rounded-full bg-[var(--hover-bg)] text-[10.5px] font-semibold text-gray-700",
                i === cur && "bg-[var(--primary-color)] text-white",
                cur > -1 && i < cur && "bg-emerald-50 text-emerald-600",
              )}
            >
              {s.n}
            </b>
            <span className="hidden lg:inline">{s.label}</span>
          </Link>
        ))}
        <span className="ml-1 flex shrink-0 gap-0.5 border-l border-[var(--border-color)] pl-1.5">
          <button
            type="button"
            className="grid size-7 place-items-center rounded-full text-gray-700 hover:bg-[var(--hover-bg)] disabled:opacity-40"
            disabled={cur <= 0}
            onClick={() => router.push(steps[Math.max(0, cur - 1)].href)}
            aria-label="Previous step"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className="grid size-7 place-items-center rounded-full text-gray-700 hover:bg-[var(--hover-bg)] disabled:opacity-40"
            disabled={cur >= steps.length - 1}
            onClick={() => router.push(steps[Math.min(steps.length - 1, cur + 1)].href)}
            aria-label="Next step"
          >
            <ChevronRight className="size-4" />
          </button>
        </span>
      </nav>
    </div>
  );
}
