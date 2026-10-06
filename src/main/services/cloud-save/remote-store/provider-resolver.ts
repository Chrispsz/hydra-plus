import { db, levelKeys } from "@main/level";
import type { CloudStorageProvider, UserPreferences } from "@types";

import { hydraApiStore } from "./hydra-api-store";
import type { CloudSaveRemoteStore } from "./types";

/**
 * Resolves which remote store the cloud-save engine should talk to.
 *
 * The user picks a global provider in the settings ("hydra" — the official
 * subscription-backed cloud — or "google-drive" — their own Drive, free).
 * A per-game override hook is planned; the global preference is the default.
 *
 * The resolver falls back to Hydra whenever the Google Drive account is not
 * linked yet, so a half-configured provider can never silently swallow
 * saves: it either works or it clearly reports "google_drive_not_linked".
 */

let cachedStore: {
  provider: CloudStorageProvider;
  store: CloudSaveRemoteStore;
} | null = null;

export const getPreferredCloudProvider =
  async (): Promise<CloudStorageProvider> => {
    try {
      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        { valueEncoding: "json" }
      );
      return userPreferences?.cloudProvider ?? "hydra";
    } catch {
      return "hydra";
    }
  };

export const isGoogleDriveCloudLinked = async (): Promise<boolean> => {
  const { isGoogleDriveLinked } = await import(
    "./google-drive/drive-token-store"
  );
  return isGoogleDriveLinked();
};

/**
 * True when the user selected Google Drive AND has a linked account.
 * Used to bypass the Hydra Cloud subscription gate — the user is not using
 * Hydra's storage at all, so there is nothing to bill.
 */
export const isGoogleDriveCloudActive = async (): Promise<boolean> =>
  (await getPreferredCloudProvider()) === "google-drive" &&
  (await isGoogleDriveCloudLinked());

export const invalidateRemoteStoreCache = () => {
  cachedStore = null;
};

export const getCloudSaveRemoteStore =
  async (): Promise<CloudSaveRemoteStore> => {
    const preferred = await getPreferredCloudProvider();
    const provider =
      preferred === "google-drive" && (await isGoogleDriveCloudLinked())
        ? "google-drive"
        : "hydra";

    if (!cachedStore || cachedStore.provider !== provider) {
      if (provider === "google-drive") {
        const { googleDriveStore } = await import("./google-drive");
        cachedStore = { provider, store: googleDriveStore };
      } else {
        cachedStore = { provider, store: hydraApiStore };
      }
    }

    return cachedStore.store;
  };
