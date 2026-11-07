import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// The SDK's next bundle (SsoLogin, Account) references optional packages
// not needed for our use case. Alias them to the no-op stub.
const OPTIONAL_STUBS = [
  "@tauri-apps/api/core",
  "@tauri-apps/api/event",
  "@tauri-apps/plugin-os",
  "@iblai/agent-ai",
  "livekit-client",
  "@livekit/components-react",
];

// ibl.ai serves avatars / tenant logos / notification images from its API and
// platform subdomains; allow next/image to optimize them (wildcard subdomains).
const IMAGE_HOSTS = [
  ...new Set([
    process.env.NEXT_PUBLIC_PLATFORM_BASE_DOMAIN || "iblai.app",
    "iblai.app",
    "iblai.org",
  ]),
];

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a build or the e2e server run beside a live `next dev` without sharing .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // `next dev` would otherwise append its "AI agents" block to AGENTS.md on every start.
  agentRules: false,
  // Dev resources are served to the server's origin only; the console is also opened at 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: IMAGE_HOSTS.map((hostname) => ({
      protocol: "https" as const,
      hostname: `**.${hostname}`,
    })),
  },
  turbopack: {
    resolveAlias: Object.fromEntries(OPTIONAL_STUBS.map((m) => [m, "./lib/tauri-stub.js"])),
  },
};

export default withNextIntl(nextConfig);
