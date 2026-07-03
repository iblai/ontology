"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ApplicationStatus, PlacementStatus } from "@/lib/types";

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-50 text-blue-700",
  incomplete: "bg-amber-50 text-amber-700",
  under_review: "bg-indigo-50 text-indigo-700",
  interview_required: "bg-purple-50 text-purple-700",
  accepted: "bg-emerald-50 text-emerald-700",
  declined: "bg-red-50 text-red-700",
  waitlisted: "bg-amber-50 text-amber-800",
  enrollment_in_progress: "bg-cyan-50 text-cyan-700",
  enrolled: "bg-emerald-100 text-emerald-800",
  withdrawn: "bg-gray-100 text-gray-500",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus;
  className?: string;
}) {
  const t = useTranslations("status");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STATUS_STYLES[status],
        className,
      )}
    >
      {t(status)}
    </span>
  );
}

const PLACEMENT_STYLES: Record<PlacementStatus, string> = {
  not_assigned: "bg-gray-100 text-gray-500",
  assigned: "bg-blue-50 text-blue-700",
  started: "bg-indigo-50 text-indigo-700",
  completed: "bg-purple-50 text-purple-700",
  reviewed: "bg-amber-50 text-amber-700",
  confirmed: "bg-emerald-50 text-emerald-700",
};

export function PlacementBadge({
  status,
  className,
}: {
  status: PlacementStatus;
  className?: string;
}) {
  const t = useTranslations("placementStatus");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        PLACEMENT_STYLES[status],
        className,
      )}
    >
      {t(status)}
    </span>
  );
}
