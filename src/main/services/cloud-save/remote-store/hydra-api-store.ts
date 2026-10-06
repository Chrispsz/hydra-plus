import { HydraApi } from "@main/services/hydra-api";
import type { CommitSnapshotResponse, DownloadedRestoreFile } from "@types";

import { validateRestoreManifest } from "./../cloud-save-contract";
import { buildDeleteGameCloudSaveSnapshotsUrl } from "./../delete-game-cloud-save-data-policy";
import { downloadRemoteSnapshotToTemp } from "./../download-remote-snapshot-to-temp";
import { listRemoteGameSnapshots } from "./../list-remote-game-snapshots";
import { isCloudSaveCommitTransportFailure } from "./../snapshot-retry-policy";
import { uploadLocalGameSnapshot } from "./../upload-local-game-snapshot";
import type {
  CloudSaveRemoteStore,
  CreateSnapshotInput,
  DownloadRestoreBlobsInput,
} from "./types";

/**
 * CloudSaveRemoteStore backed by the official Hydra API (S3 presigned
 * blobs + prepare/commit snapshots). Behaviour is identical to the stock
 * client: every request keeps `needsAuth`/`needsSubscription`, so this
 * provider only works for Hydra Cloud subscribers.
 *
 * NOTE (fork wiring, see docs/FORK.md): in the stock flow the sync
 * orchestrator calls createRemoteSnapshotFromLocalState(), which also saves
 * the local sync anchor after commit. When call sites migrate to the store
 * interface the anchor write stays the orchestrator's responsibility — it
 * already receives everything it needs from the CommitSnapshotResponse.
 */

const CONSISTENCY_ERROR = "Committed Cloud Save snapshot is inconsistent";

const validateCommitResponse = (value: unknown): CommitSnapshotResponse => {
  if (
    !value ||
    typeof value !== "object" ||
    !("snapshotId" in value) ||
    !("version" in value) ||
    !("fileCount" in value) ||
    !("totalSizeBytes" in value) ||
    !("aggregateHash" in value)
  ) {
    throw new Error("Invalid commit snapshot response");
  }

  const response = value as CommitSnapshotResponse;
  if (
    typeof response.snapshotId !== "string" ||
    response.snapshotId.length === 0 ||
    typeof response.version !== "number" ||
    !Number.isSafeInteger(response.version) ||
    response.version < 1 ||
    typeof response.fileCount !== "number" ||
    !Number.isSafeInteger(response.fileCount) ||
    response.fileCount < 0 ||
    typeof response.totalSizeBytes !== "number" ||
    !Number.isSafeInteger(response.totalSizeBytes) ||
    response.totalSizeBytes < 0 ||
    typeof response.aggregateHash !== "string" ||
    response.aggregateHash.length !== 64
  ) {
    throw new Error("Invalid commit snapshot response");
  }

  return response;
};

const commitPendingSnapshot = async (
  pendingSnapshotId: string
): Promise<CommitSnapshotResponse> => {
  let response: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await HydraApi.post<unknown>(
        "/profile/cloud-saves/commit-snapshot",
        { pendingSnapshotId },
        { needsAuth: true, needsSubscription: true }
      );
      break;
    } catch (error) {
      if (attempt === 0 && isCloudSaveCommitTransportFailure(error)) continue;
      throw error;
    }
  }
  return validateCommitResponse(response);
};

export const hydraApiStore: CloudSaveRemoteStore = {
  provider: "hydra",

  async listSnapshot({ objectId, shop }) {
    const [snapshot] = await listRemoteGameSnapshots(objectId, shop);
    return snapshot ?? null;
  },

  async createSnapshot(input: CreateSnapshotInput) {
    const { objectId, shop } = input.gameId;

    const upload = await uploadLocalGameSnapshot(
      objectId,
      shop,
      input.onProgress,
      input.context,
      {
        baseVersion: input.baseVersion,
        ...(input.retroArchFormatVersion
          ? { retroArchFormatVersion: input.retroArchFormatVersion }
          : {}),
        customPathRawPaths: input.customPathRawPaths,
        variants: input.variants,
        files: input.files,
        aggregateHash: input.snapshotHash,
      }
    );

    if (!upload.pendingSnapshotId) {
      throw new Error("cloud_save_prepare_produced_no_pending_snapshot");
    }

    const committed = await commitPendingSnapshot(upload.pendingSnapshotId);

    const expectedTotalSize = input.files.reduce(
      (total, file) => total + file.sizeBytes,
      0
    );
    if (
      committed.version !== input.baseVersion + 1 ||
      committed.fileCount !== input.files.length ||
      committed.totalSizeBytes !== expectedTotalSize ||
      committed.aggregateHash !== input.snapshotHash
    ) {
      throw new Error(CONSISTENCY_ERROR);
    }

    return committed;
  },

  async getRestoreManifest({ objectId, shop }) {
    const [snapshot] = await listRemoteGameSnapshots(objectId, shop);
    if (!snapshot) throw new Error("cloud_save_remote_snapshot_not_found");

    return validateRestoreManifest(
      await HydraApi.get<unknown>(
        "/profile/cloud-saves/snapshot-restore-manifest",
        { snapshotId: snapshot.id },
        { needsAuth: true, needsSubscription: true }
      )
    );
  },

  async downloadRestoreBlobs(
    input: DownloadRestoreBlobsInput
  ): Promise<DownloadedRestoreFile[]> {
    const { snapshot } = input.manifest;
    return downloadRemoteSnapshotToTemp(
      snapshot.id,
      snapshot.version,
      input.requestedFiles,
      input.onProgress
    );
  },

  async deleteGameCloudData({ objectId, shop }) {
    await HydraApi.delete<void>(
      buildDeleteGameCloudSaveSnapshotsUrl(objectId, shop),
      { needsAuth: true, needsSubscription: true }
    );
  },
};
