import type { CloudSaveRemoteStore } from "./types";

/**
 * Resolves which remote store the cloud-save engine should talk to.
 *
 * Hydra Plus is Drive-only: snapshots always live in the user's own
 * Google Drive (drive.file scope). There is no subscription, no Hydra
 * storage and no provider preference — if the account is not linked the
 * caller gets a clear "google_drive_not_linked" error instead of a
 * silent fallback.
 */

let cachedStore: CloudSaveRemoteStore | null = null;

export const isGoogleDriveCloudLinked = async (): Promise<boolean> => {
  const { isGoogleDriveLinked } = await import(
    "./google-drive/drive-token-store"
  );
  return isGoogleDriveLinked();
};

/**
 * Kept as the single "is the cloud-save backend usable" probe used across
 * the engine. Drive-only: active == linked.
 */
export const isGoogleDriveCloudActive = isGoogleDriveCloudLinked;

export const invalidateRemoteStoreCache = () => {
  cachedStore = null;
};

export const getCloudSaveRemoteStore =
  async (): Promise<CloudSaveRemoteStore> => {
    if (!(await isGoogleDriveCloudLinked())) {
      throw new Error("google_drive_not_linked");
    }

    if (!cachedStore) {
      const { googleDriveStore } = await import("./google-drive");
      cachedStore = googleDriveStore;
    }

    return cachedStore;
  };
