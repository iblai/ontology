// ibl.ai (iblai/vibe starter): Node 22+ exposes a localStorage global without
// getItem/setItem during SSR; the SDK probes it at import time.
if (
  typeof window === "undefined" &&
  typeof localStorage !== "undefined" &&
  typeof localStorage.getItem !== "function"
) {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } as Storage;
}

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The server image's build only (Dockerfile); dev and Vercel keep the default.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  devIndicators: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};

export default nextConfig;
