import type {
  DownloadedRestoreFile,
  RestoreManifestFile,
  RestoreManifestResponse,
} from "@types";

import { getCloudSaveRemoteStore } from "./remote-store";

export const downloadRemoteSnapshotToTemp = async (
  manifest: RestoreManifestResponse,
  requestedFiles?: RestoreManifestFile[],
  onProgress?: (processedFiles: number, totalFiles: number) => void
): Promise<DownloadedRestoreFile[]> => {
  if (requestedFiles?.length === 0) return [];

  // Hydra Plus: blobs live in the user's Drive; the store downloads them
  // by content hash into the same temp layout expected by the restore
  // pipeline. The manifest is supplied by the caller so a specific history
  // version can be restored (not just the current head).
  const store = await getCloudSaveRemoteStore();
  return store.downloadRestoreBlobs({
    manifest,
    requestedFiles,
    onProgress,
  });
};
