import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { cookies } from "next/headers";
import { SessionProvider } from "@/lib/session";
import { IblaiProviders } from "@/providers/iblai-providers";
import { AppShell } from "@/components/shell/app-shell";
import { MswProvider } from "@/components/shell/msw-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enrollment Portal",
  description:
    "Registration & enrollment for American Faith Academy and Ministry.com Network Schools",
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
            <SessionProvider>
              <MswProvider>
                <AppShell defaultSidebarOpen={defaultSidebarOpen}>{children}</AppShell>
              </MswProvider>
            </SessionProvider>
          </IblaiProviders>
        </NextIntlClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
