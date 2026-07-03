import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // ponytail: ESLint runs as a separate gate (`pnpm lint`), not on every build.
  eslint: { ignoreDuringBuilds: true },
};

export default withNextIntl(nextConfig);
