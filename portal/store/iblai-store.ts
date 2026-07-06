/**
 * Global ibl.ai Redux store — one store shared across the entire app.
 * Combines the SDK's core API slices, the applications gate slice from the
 * apply flow, and shared chat/file-upload state.
 */

import { configureStore } from "@reduxjs/toolkit";
import {
  coreApiSlice,
  mentorReducer,
  mentorMiddleware,
  applicationsApiSlice,
} from "@iblai/iblai-js/data-layer";
import { chatSliceReducerShared, filesReducer } from "@iblai/iblai-js/web-utils";

export const iblaiStore = configureStore({
  reducer: {
    [coreApiSlice.reducerPath]: coreApiSlice.reducer,
    [applicationsApiSlice.reducerPath]: applicationsApiSlice.reducer,
    ...mentorReducer,
    chatSliceShared: chatSliceReducerShared,
    files: filesReducer,
  },
  middleware: (getDefaultMiddleware) => {
    const base = getDefaultMiddleware({ serializableCheck: false })
      .concat(coreApiSlice.middleware)
      .concat(applicationsApiSlice.middleware);
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
