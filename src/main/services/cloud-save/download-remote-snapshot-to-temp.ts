import type {
  CloudSaveGameId,
  DownloadedRestoreFile,
  RestoreManifestFile,
} from "@types";

import { getCloudSaveRemoteStore } from "./remote-store";

export const downloadRemoteSnapshotToTemp = async (
  _snapshotId: string,
  _snapshotVersion: number,
  requestedFiles?: RestoreManifestFile[],
  onProgress?: (processedFiles: number, totalFiles: number) => void,
  gameId?: CloudSaveGameId
): Promise<DownloadedRestoreFile[]> => {
  if (requestedFiles?.length === 0) return [];

  // Hydra Plus: blobs live in the user's Drive; the store downloads them
  // by content hash into the same temp layout expected by the restore
  // pipeline.
  if (!gameId) {
    throw new Error("cloud_save_game_id_required_for_restore");
  }
  const store = await getCloudSaveRemoteStore();
  const manifest = await store.getRestoreManifest(gameId);
  return store.downloadRestoreBlobs({
    manifest,
    requestedFiles,
    onProgress,
  });
};
