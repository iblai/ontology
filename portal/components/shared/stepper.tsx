"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Wizard progress stepper; `accent` colors completed/current steps (school-brandable).
export function Stepper({
  steps,
  current,
  accent = "var(--primary)",
  onStepClick,
}: {
  steps: string[];
  current: number;
  accent?: string;
  onStepClick?: (index: number) => void;
}) {
  return (
    <ol className="flex w-full items-center gap-1 overflow-x-auto py-1">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = onStepClick && i < current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-1">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick(i)}
              className={cn("flex min-w-0 items-center gap-2", clickable && "cursor-pointer")}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  done || active ? "text-white" : "bg-muted text-muted-foreground",
                )}
                style={done || active ? { backgroundColor: accent } : undefined}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden truncate text-xs sm:block",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span
                className="h-px min-w-3 flex-1"
                style={{ backgroundColor: done ? accent : "var(--border)" }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
