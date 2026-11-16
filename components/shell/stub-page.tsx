"use client";

import { useState, type ReactNode } from "react";
import { QueryState } from "@/components/query-state";
import { Card, PageHeader } from "@/components/shell/page-header";
import type { Query } from "@/lib/view/types";

export type StubRow = [string, ReactNode];

/** A console route that reads as one card of two-column rows. */
export function StubPage<T>({
  title,
  description,
  actions,
  query,
  rows,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  query: Query<T>;
  rows: (data: T) => StubRow[];
}) {
  return (
    <>
      <PageHeader title={title} description={description} actions={actions} />
      <Card className="p-0">
        <QueryState query={query} className="px-4">
          {(data) =>
            rows(data).map(([k, v], i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3 text-sm last:border-b-0"
              >
                <span className="font-semibold text-gray-900">{k}</span>
                <span className="text-gray-600">{v}</span>
              </div>
            ))
          }
        </QueryState>
      </Card>
    </>
  );
}

/** Two reads as one: data once both have it, the first error, Retry refetches both. */
export function both<A, B>(a: Query<A>, b: Query<B>): Query<[A, B]> {
  return {
    data: a.data !== undefined && b.data !== undefined ? [a.data, b.data] : undefined,
    isLoading: a.isLoading || b.isLoading,
    error: a.error ?? b.error,
    refetch: () => {
      a.refetch();
      b.refetch();
    },
  };
}

/** One control's action: `busy` while it runs, `error` holds the rejection's own words. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function RunError({ error }: { error: string | null }) {
  return error ? <span className="block text-xs text-red-600">{error}</span> : null;
}
