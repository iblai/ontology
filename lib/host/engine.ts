// The engine one platform's calls reach. The engine has no notion of platforms, so each has its
// own: platforms/<folder>/engine.json, else the host's own engine, which serves one platform only.

import { hostEngine } from "./env";
import { HostError } from "./errors";
import { homePath, platformFolder, readText } from "./files";
import { currentPlatform } from "./platform";
import { serves } from "./setup";

/** The current platform's engine: its engine.json, else the host's own if it serves this one. */
export async function engine(): Promise<{ url: string; key: string }> {
  const platform = currentPlatform();
  const own = await readText(homePath("engine.json"));
  if (own !== null) return parse(own, `platforms/${platformFolder(platform)}/engine.json`);
  const host = hostEngine();
  if ((await serves(platform)) !== platform) {
    throw new HostError(
      503,
      "This host’s engine serves another platform. Its operator connects one for " +
        `“${platform}” by writing platforms/${platformFolder(platform)}/engine.json.`,
    );
  }
  return host;
}

// Never the parser's words: they quote the file, key included.
function parse(text: string, file: string): { url: string; key: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HostError(503, `${file} is not JSON.`);
  }
  const fields = (typeof value === "object" && value ? value : {}) as Record<string, unknown>;
  const url = typeof fields.url === "string" ? fields.url.replace(/\/+$/, "") : "";
  const { key } = fields;
  if (!url) throw new HostError(503, `${file} holds no “url”.`);
  if (typeof key !== "string" || !key) throw new HostError(503, `${file} holds no “key”.`);
  return { url, key };
}
