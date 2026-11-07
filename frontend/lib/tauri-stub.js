// Stub for the optional @tauri-apps/* modules the SDK's web bundle references
// (@tauri-apps/api/core, @tauri-apps/api/event, @tauri-apps/plugin-os). Those
// power the desktop (Tauri) build only; every call site is guarded at runtime by
// isTauriApp(), which is false in the browser/server, so the real modules are
// never needed here. Aliased in next.config.ts. The Proxy returns a no-op for
// any named import so webpack never reports a missing export.
module.exports = new Proxy(
  {},
  {
    get: () => () => undefined,
  },
);
