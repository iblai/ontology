import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Consistent "nothing here yet" panel — dashed card, optional icon, title,
 *  hint and action. Replaces the ad-hoc bare-<p> empties scattered per page. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center",
        className,
      )}
    >
      {Icon && <Icon className="size-6 text-muted-foreground/50" aria-hidden />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
