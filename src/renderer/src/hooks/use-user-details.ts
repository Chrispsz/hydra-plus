import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setProfileBackground,
  setUserDetails,
  clearCollections,
} from "@renderer/features";
import type { UpdateProfileRequest, UserDetails } from "@types";

export function useUserDetails() {
  const dispatch = useAppDispatch();

  const { userDetails, profileBackground } = useAppSelector(
    (state) => state.userDetails
  );

  const clearUserDetails = useCallback(async () => {
    dispatch(setUserDetails(null));
    dispatch(setProfileBackground(null));
    dispatch(clearCollections());

    globalThis.window.localStorage.removeItem("userDetails");
    window["userDetails"] = null;
  }, [dispatch]);

  const signOut = useCallback(async () => {
    clearUserDetails();

    return globalThis.window.electron.signOut();
  }, [clearUserDetails]);

  const updateUserDetails = useCallback(
    async (userDetails: UserDetails) => {
      dispatch(setUserDetails(userDetails));
      globalThis.window.localStorage.setItem(
        "userDetails",
        JSON.stringify(userDetails)
      );
    },
    [dispatch]
  );

  const fetchUserDetails = useCallback(async () => {
    return globalThis.window.electron.getMe().then((userDetails) => {
      if (userDetails == null) {
        clearUserDetails();
      }

      window["userDetails"] = userDetails;

      return userDetails;
    });
  }, [clearUserDetails]);

  const patchUser = useCallback(
    async (values: UpdateProfileRequest) => {
      const response = await globalThis.window.electron.updateProfile(values);
      return updateUserDetails({
        ...response,
        username: userDetails?.username || "",
        subscription: userDetails?.subscription || null,
        karma: userDetails?.karma || 0,
        allowCloudGifts:
          response.allowCloudGifts ?? userDetails?.allowCloudGifts ?? true,
      });
    },
    [
      updateUserDetails,
      userDetails?.username,
      userDetails?.subscription,
      userDetails?.karma,
      userDetails?.allowCloudGifts,
    ]
  );

  const hasActiveSubscription = useMemo(() => {
    const expiresAt = new Date(userDetails?.subscription?.expiresAt ?? 0);
    return expiresAt > new Date();
  }, [userDetails]);

  return {
    userDetails,
    profileBackground,
    hasActiveSubscription,
    fetchUserDetails,
    signOut,
    clearUserDetails,
    updateUserDetails,
    patchUser,
  };
}
