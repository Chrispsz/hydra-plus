export type CloudSaveAccessAction =
  | "sign-in"
  | "paywall"
  | "open"
  | "connect-drive";

/**
 * Decides what the UI should do when the user interacts with Cloud Saves.
 *
 * Hydra Plus: Cloud Saves are powered by the user's own Google Drive — no
 * Hydra Cloud subscription involved. The subscription gate only applies to
 * the official Hydra storage ("hydra" provider), which exists solely for
 * accounts with a legacy Hydra Cloud subscription.
 *
 * - "sign-in": a Hydra account is required (it powers the launcher itself).
 * - "open": the user can use Cloud Saves right away (Drive linked, or an
 *   active legacy subscription for the official storage).
 * - "connect-drive": the build ships an OAuth client, so the user simply
 *   needs to link their Google Drive (free) instead of hitting a paywall.
 * - "paywall": last-resort for builds without the OAuth client (unofficial
 *   builds) where neither Drive linking nor a subscription is available.
 */
export const getCloudSaveAccessAction = (
  isAuthenticated: boolean,
  hasActiveSubscription: boolean,
  hasOwnCloudProviderActive = false,
  hasOwnCloudProviderConfigured = true
): CloudSaveAccessAction => {
  if (!isAuthenticated) return "sign-in";
  if (hasOwnCloudProviderActive) return "open";
  if (hasActiveSubscription) return "open";
  if (hasOwnCloudProviderConfigured) return "connect-drive";
  return "paywall";
};
