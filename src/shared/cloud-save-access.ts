export type CloudSaveAccessAction = "sign-in" | "paywall" | "open";

/**
 * Decides what the UI should do when the user interacts with Cloud Saves.
 *
 * Hydra Plus: when the user selected their own Google Drive as the cloud
 * provider (and the account is linked), Cloud Saves are free — no Hydra
 * Cloud subscription is required. The subscription gate only applies to
 * the official Hydra storage ("hydra" provider).
 */
export const getCloudSaveAccessAction = (
  isAuthenticated: boolean,
  hasActiveSubscription: boolean,
  hasOwnCloudProviderActive = false
): CloudSaveAccessAction => {
  if (!isAuthenticated) return "sign-in";
  if (hasOwnCloudProviderActive) return "open";
  if (!hasActiveSubscription) return "paywall";
  return "open";
};
