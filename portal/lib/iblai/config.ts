/**
 * ibl.ai runtime configuration.
 *
 * NEXT_PUBLIC_* values must appear as literal process.env.NEXT_PUBLIC_*
 * references so Next.js inlines them at build time.
 */

const env = {
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_AUTH_URL: process.env.NEXT_PUBLIC_AUTH_URL,
  NEXT_PUBLIC_BASE_WS_URL: process.env.NEXT_PUBLIC_BASE_WS_URL,
  NEXT_PUBLIC_PLATFORM_BASE_DOMAIN: process.env.NEXT_PUBLIC_PLATFORM_BASE_DOMAIN,
  NEXT_PUBLIC_MAIN_TENANT_KEY: process.env.NEXT_PUBLIC_MAIN_TENANT_KEY,
  NEXT_PUBLIC_TAURI_CUSTOM_SCHEME: process.env.NEXT_PUBLIC_TAURI_CUSTOM_SCHEME,
};

declare global {
  interface Window {
    __ENV__?: Record<string, string>;
  }
}

const runtimeEnv = () => (typeof window !== "undefined" ? window.__ENV__ || {} : {});
const getEnv = (key: keyof typeof env, fallback = ""): string =>
  runtimeEnv()[key] ?? env[key] ?? fallback;

const domain = () => getEnv("NEXT_PUBLIC_PLATFORM_BASE_DOMAIN", "iblai.app");

const config = {
  authUrl: () => getEnv("NEXT_PUBLIC_AUTH_URL", `https://login.${domain()}`),
  lmsUrl: () => {
    const apiBase = getEnv("NEXT_PUBLIC_API_BASE_URL");
    return apiBase ? `${apiBase}/lms` : `https://learn.${domain()}`;
  },
  dmUrl: () => {
    const apiBase = getEnv("NEXT_PUBLIC_API_BASE_URL");
    return apiBase ? `${apiBase}/dm` : `https://base.manager.${domain()}`;
  },
  axdUrl: () => {
    const apiBase = getEnv("NEXT_PUBLIC_API_BASE_URL");
    return apiBase ? `${apiBase}/axd` : `https://base.manager.${domain()}`;
  },
  baseWsUrl: () => getEnv("NEXT_PUBLIC_BASE_WS_URL", `wss://asgi.data.${domain()}`),
  wsUrl: () => getEnv("NEXT_PUBLIC_BASE_WS_URL", `wss://asgi.data.${domain()}`),
  mainTenantKey: () => getEnv("NEXT_PUBLIC_MAIN_TENANT_KEY", ""),
  tauriCustomScheme: () => getEnv("NEXT_PUBLIC_TAURI_CUSTOM_SCHEME", ""),
  platformBaseDomain: () => domain(),
};

export default config;
export { getEnv };
