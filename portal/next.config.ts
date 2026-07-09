import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const tauriStub = path.resolve("./lib/tauri-stub.js");
const TAURI_MODULES = ["@tauri-apps/api/core", "@tauri-apps/api/event", "@tauri-apps/plugin-os"];
// The SDK's next bundle (SsoLogin, Account) references optional packages
// not needed for our use case. Alias them to the no-op stub.
const OPTIONAL_STUBS = [
  ...TAURI_MODULES,
  "@iblai/agent-ai",
  "livekit-client",
  "@livekit/components-react",
];

const MSW_BROWSER = path.resolve("./node_modules/msw/lib/browser/index.mjs");
// webpack resolve.alias, SDK components bind a different ReactReduxContext
// and RTK Query hooks silently return undefined with zero HTTP requests.
const RTK_DIR = path.dirname(require.resolve("@reduxjs/toolkit/package.json"));

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(OPTIONAL_STUBS.map((m) => [m, tauriStub])),
      "msw/browser": MSW_BROWSER,
      "@reduxjs/toolkit": RTK_DIR,
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      ...Object.fromEntries(OPTIONAL_STUBS.map((m) => [m, "./lib/tauri-stub.js"])),
      "msw/browser": path.relative(process.cwd(), MSW_BROWSER),
      "@reduxjs/toolkit": path.relative(process.cwd(), RTK_DIR),
    },
  },
};

export default withNextIntl(nextConfig);
