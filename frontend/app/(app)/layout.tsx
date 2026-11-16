import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { Walkthrough } from "@/components/shell/walkthrough";
import { TooltipProvider } from "@/components/ui/tooltip";

// Authenticated shell. Wire ibl.ai SSO here via /iblai-vibe-auth (AuthProvider >
// TenantProvider) once platform credentials are in iblai.env; the shell itself
// does not change.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const walkthrough = process.env.NEXT_PUBLIC_WALKTHROUGH !== "0";
  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden bg-[#f6f8fe]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
            <div className="min-h-full rounded-xl border border-[var(--border-color)] bg-white px-5 py-6 pb-24 md:px-7">{children}</div>
          </main>
        </div>
        {walkthrough && <Walkthrough />}
      </div>
    </TooltipProvider>
  );
}
