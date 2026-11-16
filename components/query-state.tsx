"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import type { Query } from "@/lib/view/types";
import { cn } from "@/lib/utils";

/** One look for every read: the OS arc while loading, the server's words and a Retry on failure. */
export function QueryState<T>({
  query,
  children,
  className,
}: {
  query: Query<T>;
  children: (data: T) => ReactNode;
  className?: string;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) {
    return (
      <div
        className={cn("flex flex-wrap items-center gap-3 py-6 text-sm text-gray-600", className)}
      >
        <span className="min-w-0 flex-1 break-words">{query.error}</span>
        <Button size="sm" variant="outline" onClick={query.refetch}>
          Retry
        </Button>
      </div>
    );
  }
  return <LoadingScreen className={cn("min-h-40 bg-transparent", className)} />;
}
