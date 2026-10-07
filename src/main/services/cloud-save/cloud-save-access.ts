import {
  getCloudSaveAccessAction,
  SubscriptionRequiredError,
  UserNotLoggedInError,
} from "@shared";

import { HydraApi } from "../hydra-api";
import { isGoogleDriveCloudActive } from "./remote-store/provider-resolver";

export const canAccessCloudSaves = (
  isLoggedIn: boolean,
  hasActiveSubscription: boolean
) => getCloudSaveAccessAction(isLoggedIn, hasActiveSubscription) === "open";

/**
 * Guards Cloud Save operations on the main process.
 *
 * Hydra Plus: when the user selected their own Google Drive as the cloud
 * provider (and it is linked), the Hydra Cloud subscription is not
 * required — the sync engine talks to the user's Drive, not to Hydra's
 * storage. A Hydra account is still required because it powers the
 * launcher itself (library, profile, downloads metadata).
 *
 * NOTE: async since the provider preference lives in LevelDB.
 * Always `await` this function.
 */
export const assertCloudSaveSubscription = async (
  isLoggedIn = HydraApi.isLoggedIn(),
  hasActiveSubscription = HydraApi.hasActiveSubscription()
) => {
  if (!isLoggedIn) {
    throw new UserNotLoggedInError();
  }

  if (await isGoogleDriveCloudActive()) {
    return;
  }

  if (!hasActiveSubscription) {
    throw new SubscriptionRequiredError();
  }
};
