// The engine one platform's calls reach. The engine has no notion of platforms, so each has its
// own: platforms/<folder>/engine.json, else the server's own engine (AO_URL), which belongs to
// the one platform ONTOLOGY_PLATFORM names.

import { isThisMachine } from "./address";
import { engineKey } from "./engine-key";
import { engineUrl } from "./env";
import { HostError } from "./errors";
import { homePath, platformFolder, readText } from "./files";
import { assertServed, currentPlatform } from "./platform";

type Engine = { url: string; key: string };

/** The current platform's engine: its engine.json, else the server's own. */
export async function engine(): Promise<Engine> {
  const platform = currentPlatform();
  // Asked here too, where an engine is handed out: each holds one platform's data.
  assertServed(platform);
  const file = `platforms/${platformFolder(platform)}/engine.json`;
  const own = await readText(homePath("engine.json"));
  if (own !== null) return elsewhere(parse(own, file), file);
  const url = engineUrl();
  if (url === null) {
    throw new HostError(
      503,
      `No engine is connected for “${platform}”. This server’s operator sets AO_URL, or writes ` +
        `${file}.`,
    );
  }
  return { url, key: await engineKey(url) };
}

// A local engine has one way in, AO_URL: a platform's file names an engine on another machine.
async function elsewhere(found: Engine, file: string): Promise<Engine> {
  const host = URL.canParse(found.url) ? new URL(found.url).hostname : "";
  if (!host) throw new HostError(503, `${file} holds a “url” that is not an address.`);
  if (await isThisMachine(host)) {
    throw new HostError(
      503,
      `${file} names an engine on this machine. A local engine is the server’s own: its operator ` +
        "sets AO_URL and ONTOLOGY_PLATFORM instead.",
    );
  }
  return found;
}

// Never the parser's words: they quote the file, key included.
function parse(text: string, file: string): Engine {
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
