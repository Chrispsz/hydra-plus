export type CloudSaveAccessAction = "open" | "connect-drive";

/**
 * Decides what the UI should do when the user interacts with Cloud Saves.
 *
 * Hydra Plus is Drive-only and account-less: there is no Hydra Cloud
 * subscription, no sign-in and no paywall. Cloud Saves need the user's
 * Google Drive account linked — either the build ships an OAuth client
 * ("connect-drive") or the user pastes their own client id/secret in
 * settings first.
 */
export const getCloudSaveAccessAction = (
  isGoogleDriveLinked: boolean
): CloudSaveAccessAction => {
  if (isGoogleDriveLinked) return "open";
  return "connect-drive";
};
