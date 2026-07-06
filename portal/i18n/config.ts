/**
 * Supported UI locales. English-only for now; adding a language is:
 *   1. drop `messages/<locale>.json`
 *   2. add the code here (and a label)
 * A header switcher can then set the `NEXT_LOCALE` cookie — no URL routing.
 */
export const SUPPORTED_LOCALES = ["en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie used to persist the selected language (no URL routing). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Human-readable labels for a future language selector. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
};

/** Narrow an arbitrary string to a supported locale, falling back to default. */
export function resolveLocale(value: string | undefined | null): Locale {
  if (!value) return DEFAULT_LOCALE;
  const v = value.toLowerCase().trim();
  const supported = SUPPORTED_LOCALES as readonly string[];
  if (supported.includes(v)) return v as Locale;
  const base = v.split(/[-_]/)[0];
  if (supported.includes(base)) return base as Locale;
  return DEFAULT_LOCALE;
}
