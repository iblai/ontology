import type { SchoolConfig } from "./types";
import { afa } from "./afa";
import { graceNetwork } from "./grace-network";

export * from "./types";

const REGISTRY: Record<string, SchoolConfig> = {
  [afa.slug]: afa,
  [graceNetwork.slug]: graceNetwork,
};

export function getSchoolConfig(slug: string): SchoolConfig | undefined {
  return REGISTRY[slug];
}

export function listSchoolConfigs(): SchoolConfig[] {
  return Object.values(REGISTRY);
}
