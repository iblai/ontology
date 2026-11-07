/**
 * Global ibl.ai Redux store — one store shared across the entire app.
 * Combines the SDK's core API slices and shared chat/file-upload state.
 *
 * NOTE: the applications-gate slice (`applicationsApiSlice`) existed only in
 * the 1.22.4-onboarding-v2.2 prerelease line; @iblai/iblai-js@1.23.1 stable
 * does not ship it. Re-register the slice here (reducer + middleware) once
 * the gate feature lands in a stable SDK release. Nothing consumed its
 * endpoints yet, so nothing else changed.
 */

import { configureStore } from "@reduxjs/toolkit";
import { coreApiSlice, mentorReducer, mentorMiddleware } from "@iblai/iblai-js/data-layer";
import { chatSliceReducerShared, filesReducer, rbacReducer } from "@iblai/iblai-js/web-utils";

export const iblaiStore = configureStore({
  reducer: {
    [coreApiSlice.reducerPath]: coreApiSlice.reducer,
    ...mentorReducer,
    chatSliceShared: chatSliceReducerShared,
    files: filesReducer,
    // `rbac` key is required — selectRbacPermissions reads state.rbac. Not part
    // of mentorReducer; populated by TenantProvider's onLoadPlatformPermissions.
    rbac: rbacReducer,
  },
  middleware: (getDefaultMiddleware) => {
    const base = getDefaultMiddleware({ serializableCheck: false }).concat(coreApiSlice.middleware);
    // Dedupe by reference identity. RTK Query middleware functions all
    // share the name "middleware", so a name-based dedup collapses to one
    // entry and silently drops every other slice's middleware — which is
    // exactly how customDomainApiSlice.middleware got lost (its reducer was
    // still registered via mentorReducer, hence the RTK-Query warning).
    const seen = new Set(base);
    for (const mw of mentorMiddleware) {
      if (!seen.has(mw)) {
        seen.add(mw);
        base.push(mw);
      }
    }
    return base;
  },
});

export type IblaiRootState = ReturnType<typeof iblaiStore.getState>;
export type IblaiAppDispatch = typeof iblaiStore.dispatch;
