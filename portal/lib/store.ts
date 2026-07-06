import { configureStore } from "@reduxjs/toolkit";
import { applicationsApiSlice, initializeDataLayer } from "@iblai/iblai-js/data-layer";

// The SDK's data layer talks to the DM service at `Config.dmUrl + /api/catalog/...`.
// Point it at same-origin ("") so RTK Query hits our Next.js mock route handlers
// under app/api/catalog/applications/platform/*. `getHeaders` throws unless
// `IblDataLayer.storage` is set, but tolerates a null token — so a no-op storage
// shim is enough for the dev/mock environment (no real auth).
const DM_URL = process.env.NEXT_PUBLIC_IBL_DM_URL ?? "";

const memoryStore = new Map<string, string>();
const storageShim = {
  getItem: async (key: string): Promise<string | null> => memoryStore.get(key) ?? null,
  setItem: async (key: string, value: string): Promise<void> => {
    memoryStore.set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    memoryStore.delete(key);
  },
};

let initialized = false;
function ensureDataLayer(): void {
  if (initialized) return;
  initializeDataLayer(DM_URL, DM_URL, DM_URL, storageShim);
  initialized = true;
}

export function createStore() {
  ensureDataLayer();
  return configureStore({
    reducer: {
      [applicationsApiSlice.reducerPath]: applicationsApiSlice.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(applicationsApiSlice.middleware),
  });
}

export const store = createStore();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
