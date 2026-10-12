import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { UserDetails } from "@types";

export interface UserDetailsState {
  userDetails: UserDetails | null;
}

const initialState: UserDetailsState = {
  userDetails: null,
};

export const userDetailsSlice = createSlice({
  name: "user-details",
  initialState,
  reducers: {
    setUserDetails: (state, action: PayloadAction<UserDetails | null>) => {
      state.userDetails = action.payload;
    },
  },
});

export const { setUserDetails } = userDetailsSlice.actions;
