import { cn } from "@/lib/utils";

/** The label-left, value-right rows the cards share: one grid, two columns from `sm`. */
export function Facts({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-x-6 gap-y-2 sm:grid-cols-2", className)}>{children}</div>;
}

export function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-foreground text-sm">{value}</span>
    </div>
  );
}
