import { isGameRunning } from "@main/services/process-watcher";
import { WindowManager } from "@main/services/window-manager";
import type {
  CloudSaveSyncProgressStage,
  GameShop,
  RestoreProgressStage,
  RestoreRemoteSnapshotResult,
  SnapshotVersionSummary,
} from "@types";

import { assertCloudSaveDriveLinked } from "./cloud-save-access";
import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash";
import {
  cloudSaveOperationGate,
  cloudSaveOperationScopeKey,
} from "./operation-gate";
import { assertCloudSaveDeletionNotPending } from "./pending-deletion";
import { getCloudSaveRemoteStore } from "./remote-store";
import { restoreRemoteSnapshot } from "./restore-remote-snapshot";

export type SnapshotVersionProgressCallback = (payload: {
  stage: CloudSaveSyncProgressStage;
  processedFiles: number;
  totalFiles: number;
}) => void;

/** Maps the restore pipeline stages onto the shared sync progress stages. */
const translateRestoreStage = (
  stage: RestoreProgressStage
): CloudSaveSyncProgressStage => {
  switch (stage) {
    case "completed":
      return "completed";
    case "downloading":
    case "verifying":
    case "applying_restore":
      return "restoring";
    default:
      return "analyzing";
  }
};

const assertGameNotRunningForRestore = (objectId: string, shop: GameShop) => {
  if (isGameRunning(objectId, shop)) {
    throw new Error("cloud_save_restore_game_running");
  }
};

export const listGameSnapshotVersions = async (
  objectId: string,
  shop: GameShop
): Promise<SnapshotVersionSummary[]> => {
  await assertCloudSaveDriveLinked();
  const store = await getCloudSaveRemoteStore();
  return store.listSnapshotVersions({ objectId, shop });
};

/**
 * Restores ONE specific history version over the local files.
 *
 * The sync anchor is deliberately NOT updated: the restored state becomes
 * "locally changed" relative to the remote head, so the next automatic
 * sync uploads it as a NEW version instead of being overwritten by the
 * newer head. Restoring an old save therefore survives sync.
 */
export const restoreGameSnapshotVersion = async (
  objectId: string,
  shop: GameShop,
  version: number,
  onProgress?: SnapshotVersionProgressCallback
): Promise<RestoreRemoteSnapshotResult> => {
  await assertCloudSaveDriveLinked();
  assertGameNotRunningForRestore(objectId, shop);

  return cloudSaveOperationGate.runSync(
    cloudSaveOperationScopeKey(objectId, shop),
    "restore-snapshot-version",
    async () => {
      const store = await getCloudSaveRemoteStore();
      const manifest = await store.getSnapshotVersionManifest(
        { objectId, shop },
        version
      );

      const knownSummary = {
        id: manifest.snapshot.id,
        version: manifest.snapshot.version,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fileCount: manifest.files.length,
        totalSizeBytes: manifest.files.reduce(
          (total, file) => total + file.sizeBytes,
          0
        ),
        aggregateHash: buildCloudSaveAggregateHash({
          variants: manifest.variants,
          files: manifest.files,
        }),
      };

      return restoreRemoteSnapshot(
        knownSummary.id,
        { objectId, shop },
        onProgress
          ? (progress) =>
              onProgress({
                stage: translateRestoreStage(progress.stage),
                processedFiles: progress.processedFiles,
                totalFiles: progress.totalFiles,
              })
          : undefined,
        knownSummary,
        undefined,
        undefined,
        false,
        [],
        0,
        undefined,
        { manifestOverride: manifest, skipCurrentHeadCheck: true }
      );
    },
    () => assertCloudSaveDeletionNotPending(objectId, shop)
  );
};

export const deleteGameSnapshotVersion = async (
  objectId: string,
  shop: GameShop,
  version: number
): Promise<void> => {
  await assertCloudSaveDriveLinked();
  if (isGameRunning(objectId, shop)) {
    throw new Error("cloud_save_delete_game_running");
  }

  const store = await getCloudSaveRemoteStore();
  await store.deleteSnapshotVersion({ objectId, shop }, version);
  WindowManager.sendToAppWindows("on-library-batch-complete");
};

export const downloadGameSnapshotVersionToFolder = async (
  objectId: string,
  shop: GameShop,
  version: number,
  destinationFolder: string,
  onProgress?: (processedFiles: number, totalFiles: number) => void
): Promise<{ fileCount: number; totalSizeBytes: number }> => {
  await assertCloudSaveDriveLinked();

  const store = await getCloudSaveRemoteStore();
  return store.downloadSnapshotVersionToFolder(
    { objectId, shop },
    version,
    destinationFolder,
    onProgress
  );
};
