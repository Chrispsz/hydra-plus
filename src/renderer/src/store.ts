import { configureStore } from "@reduxjs/toolkit";
import {
  downloadSlice,
  windowSlice,
  librarySlice,
  userPreferencesSlice,
  toastSlice,
  gameRunningSlice,
  catalogueSearchSlice,
  userDetailsSlice,
} from "@renderer/features";

export const store = configureStore({
  reducer: {
    window: windowSlice.reducer,
    library: librarySlice.reducer,
    userPreferences: userPreferencesSlice.reducer,
    download: downloadSlice.reducer,
    toast: toastSlice.reducer,
    gameRunning: gameRunningSlice.reducer,
    catalogueSearch: catalogueSearchSlice.reducer,
    userDetails: userDetailsSlice.reducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
