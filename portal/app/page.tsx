"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homeFor, useSession } from "@/lib/session";

export default function RootPage() {
  const { user, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? homeFor(user.role) : "/login");
  }, [ready, user, router]);

  return (
    <div className="flex h-dvh items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
