import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

import type { LibraryGame } from "@types";

export interface LibraryState {
  value: LibraryGame[];
  downloadLibrary: LibraryGame[];
  searchQuery: string;
  hasLoaded: boolean;
}

const initialState: LibraryState = {
  value: [],
  downloadLibrary: [],
  searchQuery: "",
  hasLoaded: false,
};

export const librarySlice = createSlice({
  name: "library",
  initialState,
  reducers: {
    setLibrary: (state, action: PayloadAction<LibraryState["value"]>) => {
      state.value = action.payload.filter((game) => !game.isConcealed);
      state.downloadLibrary = action.payload;
      state.hasLoaded = true;
    },

    updateGameNewDownloadOptions: (
      state,
      action: PayloadAction<{ gameId: string; count: number }>
    ) => {
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find((g) => g.id === action.payload.gameId);
        if (game) {
          game.newDownloadOptionsCount = action.payload.count;
        }
      }
    },
    clearNewDownloadOptions: (
      state,
      action: PayloadAction<{ gameId: string }>
    ) => {
      for (const library of [state.value, state.downloadLibrary]) {
        const game = library.find((g) => g.id === action.payload.gameId);
        if (game) {
          game.newDownloadOptionsCount = undefined;
        }
      }
    },
    setLibrarySearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
  },
});

export const {
  setLibrary,
  updateGameNewDownloadOptions,
  clearNewDownloadOptions,
  setLibrarySearchQuery,
} = librarySlice.actions;

export const selectIsLibraryLoading = (state: { library: LibraryState }) =>
  !state.library.hasLoaded || state.library.value.length === 0;
