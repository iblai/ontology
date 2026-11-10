import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  badge,
  subtitle,
  actions,
  className,
}: {
  title: string;
  /** A status pill beside the title; the heading itself stays text. */
  badge?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-foreground text-xl font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
