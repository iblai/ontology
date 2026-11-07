"use client";

import { useCallback, useEffect, useState } from "react";

/** Tiny async loader: runs `fn` on mount/dep change, exposes `reload`. */
export function useLoad<T>(
  fn: () => Promise<T | undefined>,
  deps: unknown[],
): { data: T | undefined; loading: boolean; reload: () => Promise<void> } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, reload: load };
}
