// ibl.ai (iblai/vibe starter): Node 22+ exposes a localStorage global without
// getItem/setItem during SSR; the SDK probes it at import time.
if (typeof window === "undefined" && typeof localStorage !== "undefined" && typeof localStorage.getItem !== "function") {
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
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * Resolve a package to one directory so the SDK and the app share a single
 * copy. A duplicated @reduxjs/toolkit / react-redux gives SDK components a
 * different ReactReduxContext and RTK Query hooks silently return undefined.
 */
function dedup(name: string): string | undefined {
  try {
    const entry = require.resolve(name);
    const marker = `node_modules/${name}`;
    const i = entry.lastIndexOf(marker);
    return i === -1 ? undefined : entry.slice(0, i + marker.length);
  } catch {
    return undefined;
  }
}
const aliases: Record<string, string> = {};
for (const pkg of ["@reduxjs/toolkit", "react-redux"]) {
  const dir = dedup(pkg);
  if (dir) aliases[pkg] = dir;
}

const nextConfig: NextConfig = {
  devIndicators: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = { ...(config.resolve.alias || {}), ...aliases };
    return config;
  },
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};

export default nextConfig;
