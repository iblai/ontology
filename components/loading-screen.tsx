"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** The OS loading look: white, a centred arc in brand blue. */
export function LoadingScreen({ message, className }: { message?: string; className?: string }) {
  return (
    <output
      aria-live="polite"
      aria-label={message ?? "Loading"}
      className={cn(
        "flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-white",
        className,
      )}
    >
      <Loader2 className="size-8 animate-spin text-[#2563EB]" />
      {message && <p className="text-muted-foreground text-sm">{message}</p>}
    </output>
  );
}
