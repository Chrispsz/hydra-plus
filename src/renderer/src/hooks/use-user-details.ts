import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setUserDetails } from "@renderer/features";
import type { UserDetails } from "@types";

const USER_DETAILS_STORAGE_KEY = "userDetails";

export function useUserDetails() {
  const dispatch = useAppDispatch();

  const { userDetails } = useAppSelector((state) => state.userDetails);

  const clearUserDetails = useCallback(() => {
    dispatch(setUserDetails(null));
    globalThis.window.localStorage.removeItem(USER_DETAILS_STORAGE_KEY);
  }, [dispatch]);

  const updateUserDetails = useCallback(
    (userDetails: UserDetails) => {
      dispatch(setUserDetails(userDetails));
      globalThis.window.localStorage.setItem(
        USER_DETAILS_STORAGE_KEY,
        JSON.stringify(userDetails)
      );
    },
    [dispatch]
  );

  const fetchUserDetails = useCallback(async () => {
    try {
      const me = await globalThis.window.electron.getMe();

      if (me) {
        updateUserDetails(me);
      } else {
        clearUserDetails();
      }

      return me;
    } catch {
      return null;
    }
  }, [updateUserDetails, clearUserDetails]);

  const signOut = useCallback(async () => {
    clearUserDetails();
    await globalThis.window.electron.signOut();
  }, [clearUserDetails]);

  return {
    userDetails,
    fetchUserDetails,
    signOut,
    clearUserDetails,
    updateUserDetails,
  };
}
