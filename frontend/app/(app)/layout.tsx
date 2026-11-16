import { IblaiProviders } from "@/providers/iblai-providers";
import { SessionProvider } from "@/lib/iblai/session";
import { AppShell } from "@/components/shell/app-shell";

// Authenticated area. The SSO callback is in app/(auth) so it is not wrapped.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <IblaiProviders>
      <SessionProvider>
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </IblaiProviders>
  );
}
