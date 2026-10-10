export type CloudSaveAccessAction = "sign-in" | "open" | "connect-drive";

/**
 * Decides what the UI should do when the user interacts with Cloud Saves.
 *
 * Hydra Plus is Drive-only: there is no Hydra Cloud subscription and no
 * paywall. Cloud Saves need the user's Google Drive account linked —
 * either the build ships an OAuth client ("connect-drive") or the user
 * pastes their own client id/secret in settings first.
 */
export const getCloudSaveAccessAction = (
  isAuthenticated: boolean,
  isGoogleDriveLinked: boolean
): CloudSaveAccessAction => {
  if (!isAuthenticated) return "sign-in";
  if (isGoogleDriveLinked) return "open";
  return "connect-drive";
};
