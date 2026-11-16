// The platform a call is made for. The browser names it, or the address does; ibl.ai confirms
// it on the host. Shared by the browser and the host: no Node import here.

/** The header a console call names its platform in. */
export const PLATFORM_HEADER = "x-ontology-platform";

// An ibl.ai platform key as it can stand in one path segment (the DM itself checks no characters).
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/** Whether a value can be a platform key. */
export const isPlatformKey = (value: unknown): value is string =>
  typeof value === "string" && KEY.test(value);

/** The path agents call a server on: /<platform>/<slug>/mcp. */
export const mcpPath = (platform: string, slug: string) =>
  `/${encodeURIComponent(platform)}/${encodeURIComponent(slug)}/mcp`;
