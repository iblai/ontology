import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { cookies } from "next/headers";
import { IblaiProviders } from "@/providers/iblai-providers";
import { AppShell } from "@/components/shell/app-shell";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ontology Console · ibl.ai",
  description:
    "Admin console for iblai/ontology — the on-premise knowledge layer that makes your systems queryable by AI agents over MCP.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <IblaiProviders>
            <AppShell defaultSidebarOpen={defaultSidebarOpen}>{children}</AppShell>
          </IblaiProviders>
        </NextIntlClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
