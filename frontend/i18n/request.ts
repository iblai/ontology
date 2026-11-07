import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "./config";

/**
 * next-intl request config (no i18n routing). The active locale is resolved
 * from the `NEXT_LOCALE` cookie, falling back to the default locale. Messages
 * are loaded from `messages/<locale>.json`.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value);

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
