import { cookies } from "next/headers";
import { PortalShell } from "@/components/shell/portal-shell";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return <PortalShell defaultOpen={defaultOpen}>{children}</PortalShell>;
}
