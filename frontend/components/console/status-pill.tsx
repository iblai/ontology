import { cn } from "@/lib/utils";
import type { Palette } from "@/lib/ontology/format";

// The top bar's data-source pill: grey text, the state in a small dot, never a blue one.
const DOT: Record<Palette, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
  info: "bg-[#9ca3af]",
  neutral: "bg-[#9ca3af]",
  neutralMuted: "bg-[#d4d4d8]",
};

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: Palette;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      data-slot="status-pill"
      className={cn(
        "text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden />
      {children}
    </span>
  );
}
