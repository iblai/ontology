// Next's start-up hook. A server with an engine of its own and no ONTOLOGY_PLATFORM does not
// start: the error thrown here ends the process, naming the setting.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ownPlatform } = await import("@/lib/host/env");
  ownPlatform();
}
