import { assertCloudSaveDriveLinked } from "./cloud-save-access";
import { getCloudSaveRemoteStore } from "./remote-store";

/**
 * Google Drive hygiene operations for the settings screen: storage usage,
 * trash cleanup (the sync engine only trashes manifests — this is what
 * reclaims the space) and orphan blob GC (blobs no longer referenced by
 * any version manifest).
 */
export const getGoogleDriveHygieneOverview = async () => {
  await assertCloudSaveDriveLinked();
  const store = await getCloudSaveRemoteStore();
  return store.getDriveHygieneOverview();
};

export const cleanupGoogleDriveTrash = async () => {
  await assertCloudSaveDriveLinked();
  const store = await getCloudSaveRemoteStore();
  return store.cleanupDriveTrash();
};

export const deleteGoogleDriveOrphanBlobs = async () => {
  await assertCloudSaveDriveLinked();
  const store = await getCloudSaveRemoteStore();
  return store.deleteOrphanBlobs();
};
