import os from "node:os";

import type {
  CloudSaveUploadProgress,
  CommitSnapshotResponse,
  GameShop,
  LocalGameSnapshotContext,
  RemoteGameSnapshot,
} from "@types";

import { getCloudSaveRemoteStore } from "./remote-store";

import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash";
import { assertCloudSaveV2Eligible } from "./assert-cloud-save-executable";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";
import { shouldReprepareCloudSaveSnapshot } from "./snapshot-retry-policy";
import type { SnapshotFile, SnapshotVariant } from "@types";

type ProgressCallback = (progress: CloudSaveUploadProgress) => void;

export interface PrepareLocalSnapshotOptions {
  baseVersion: number;
  customPathRawPaths?: string[];
  variants?: SnapshotVariant[];
  files?: SnapshotFile[];
  aggregateHash?: string;
}

export interface CreateRemoteSnapshotOptions
  extends PrepareLocalSnapshotOptions {
  expectedSnapshotId?: string | null;
  unresolvedRemoteEntryIds?: string[];
  updateAnchor?: boolean;
  assertEnvironmentCurrent?: () => Promise<void>;
}

const resolveCreateRemoteSnapshotOptions = (
  options?: CreateRemoteSnapshotOptions
) => {
  if (options !== undefined) return options;
  return { baseVersion: 0 };
};

/**
 * Hydra Plus: snapshot upload to the user's own Google Drive. The store
 * owns the whole transport (blob dedupe, manifest write, optimistic
 * versioning); consistency validation and the sync anchor update keep the
 * sync engine contract intact.
 */
const createRemoteSnapshotInGoogleDrive = async (
  objectId: string,
  shop: GameShop,
  onProgress: ProgressCallback | undefined,
  context: LocalGameSnapshotContext,
  resolvedOptions: CreateRemoteSnapshotOptions,
  variants: SnapshotVariant[],
  files: SnapshotFile[],
  customPathRawPaths: string[],
  expectedAggregateHash: string
): Promise<RemoteGameSnapshot | null> => {
  const store = await getCloudSaveRemoteStore();

  let committed: CommitSnapshotResponse | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await resolvedOptions.assertEnvironmentCurrent?.();
      committed = await store.createSnapshot({
        gameId: { objectId, shop },
        platform: context.pathContext.platform,
        hostname: os.hostname() || undefined,
        snapshotHash: expectedAggregateHash,
        baseVersion: resolvedOptions.baseVersion,
        customPathRawPaths,
        variants,
        files,
        context,
        onProgress,
      });
      break;
    } catch (error) {
      // Version conflicts are surfaced to the sync engine, which decides
      // between re-analysis and merge — same contract as the Hydra API.
      if (
        error instanceof Error &&
        error.message.includes("cloud_save_snapshot_version_conflict")
      ) {
        throw error;
      }
      if (attempt === 0 && shouldReprepareCloudSaveSnapshot(error)) continue;
      throw error;
    }
  }
  if (!committed) throw new Error("Cloud Save commit did not complete");

  const expectedTotalSize = files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  );
  if (
    committed.version !== resolvedOptions.baseVersion + 1 ||
    (resolvedOptions.expectedSnapshotId &&
      committed.snapshotId !== resolvedOptions.expectedSnapshotId) ||
    committed.fileCount !== files.length ||
    committed.totalSizeBytes !== expectedTotalSize ||
    committed.aggregateHash !== expectedAggregateHash
  ) {
    throw new Error("Committed Cloud Save snapshot is inconsistent");
  }

  if (resolvedOptions.updateAnchor !== false) {
    await resolvedOptions.assertEnvironmentCurrent?.();
    await saveCloudSaveSyncAnchor(shop, objectId, context.environmentId, {
      schemaVersion: 4,
      environmentId: context.environmentId,
      baseSnapshotId: committed.snapshotId,
      baseVersion: committed.version,
      baseAggregateHash: committed.aggregateHash,
      entries: files.map((file) => ({
        variantId: file.variantId,
        rawPath: file.rawPath,
        relativePath: file.relativePath,
        hash: file.hash,
        sizeBytes: file.sizeBytes,
        ...(file.stateMetadata ? { stateMetadata: file.stateMetadata } : {}),
      })),
      unresolvedRemoteEntryIds: (
        resolvedOptions.unresolvedRemoteEntryIds ?? []
      ).filter((entryId) =>
        files.some((file) => cloudSaveFileKey(file) === entryId)
      ),
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    id: committed.snapshotId,
    version: committed.version,
    fileCount: committed.fileCount,
    totalSizeBytes: committed.totalSizeBytes,
    aggregateHash: committed.aggregateHash,
  };
};

export const createRemoteSnapshotFromLocalState = async (
  objectId: string,
  shop: GameShop,
  onProgress?: ProgressCallback,
  localSnapshotContext?: LocalGameSnapshotContext,
  options?: CreateRemoteSnapshotOptions
): Promise<RemoteGameSnapshot | null> => {
  await assertCloudSaveV2Eligible(objectId, shop);
  const resolvedOptions = resolveCreateRemoteSnapshotOptions(options);
  const context =
    localSnapshotContext ??
    (await buildLocalGameSnapshotContext(objectId, shop));
  const variants = resolvedOptions.variants ?? context.variants;
  const files: SnapshotFile[] = resolvedOptions.files ?? context.files;
  const customPathRawPaths =
    resolvedOptions.customPathRawPaths ?? context.customPathRawPaths;
  const expectedAggregateHash =
    resolvedOptions.aggregateHash ??
    buildCloudSaveAggregateHash({ variants, files });

  return createRemoteSnapshotInGoogleDrive(
    objectId,
    shop,
    onProgress,
    context,
    resolvedOptions,
    variants,
    files,
    customPathRawPaths,
    expectedAggregateHash
  );
};
