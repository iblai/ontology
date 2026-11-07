"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Calls `open` when the URL asks for `?new=<kind>` (the New menu, the palette), then drops the parameter. */
export function useCreateParam(kind: string, open: () => void) {
  const wanted = useSearchParams().get("new") === kind;
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!wanted) return;
    open();
    router.replace(pathname, { scroll: false });
    // `open` is a fresh closure on every render; the parameter is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
}
