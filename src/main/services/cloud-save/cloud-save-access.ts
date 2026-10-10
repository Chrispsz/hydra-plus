import { isGoogleDriveCloudLinked } from "./remote-store/provider-resolver";

/**
 * Guards Cloud Save operations on the main process.
 *
 * Hydra Plus is Drive-only: there is no Hydra Cloud subscription and no
 * Hydra storage. A snapshot operation simply requires the user's Google
 * Drive account to be linked — every failure surfaces as the actionable
 * "google_drive_not_linked" error so the UI can offer reconnection.
 */
export const assertCloudSaveDriveLinked = async () => {
  if (!(await isGoogleDriveCloudLinked())) {
    throw new Error("google_drive_not_linked");
  }
};
