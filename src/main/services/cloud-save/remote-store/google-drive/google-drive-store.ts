import fs from "node:fs";
import path from "node:path";
import { SystemPath } from "@main/services/system-path";
import { logger } from "@main/services/logger";
import type {
  CommitSnapshotResponse,
  DownloadedRestoreFile,
  RemoteSnapshotSummary,
  RestoreManifestResponse,
  SnapshotFile,
} from "@types";

import {
  cloudSaveFileKey,
  validateRestoreManifest,
} from "./../../cloud-save-contract";
import { mapWithConcurrency } from "./../../map-with-concurrency";
import { buildCloudSaveAggregateHash } from "./../../snapshot-aggregate-hash";
import { assertCloudSaveUploadWithinLimits } from "./../../upload-limits";
import type {
  CloudSaveRemoteStore,
  CreateSnapshotInput,
  DownloadRestoreBlobsInput,
} from "./../types";
import {
  downloadFileToFile,
  ensureFolder,
  ensureRootStructure,
  findChildByName,
  readFileJson,
  resetFolderStructureCache,
  trashFile,
  updateFileContent,
  uploadFile,
} from "./drive-client";

/**
 * CloudSaveRemoteStore backed by the user's own Google Drive.
 *
 * Layout (everything inside `Hydra Plus Saves/`, scope drive.file):
 *
 *   Hydra Plus Saves/
 *     blobs/<sha256>.blob          ← content-addressed pool, dedup across games
 *     games/<shop>/<objectId>/
 *       manifest.json              ← RestoreManifestResponse + updatedAt
 *
 * The manifest file IS the source of truth (no separate index to corrupt).
 * Blob dedupe happens by filename (= sha256). Optimistic versioning follows
 * the same contract as the Hydra API: a commit must observe baseVersion on
 * disk, otherwise the caller retries with the standard re-prepare policy.
 */

const MANIFEST_FILE_NAME = "manifest.json";
const MAX_CONCURRENT_DRIVE_UPLOADS = 4;
const MAX_CONCURRENT_DRIVE_DOWNLOADS = 4;
const BLOB_MIME = "application/octet-stream";

const blobFileName = (hash: string) => `${hash}.blob`;
const blobKey = (file: Pick<SnapshotFile, "hash" | "sizeBytes">) =>
  JSON.stringify([file.hash, file.sizeBytes]);

/**
 * The stored manifest uses the exact RestoreManifestResponse shape — the
 * shared contract validators are strict about unknown keys. Timestamps come
 * from Drive file metadata and the aggregate hash is recomputed from the
 * manifest contents, so nothing redundant is persisted.
 */
type StoredManifest = RestoreManifestResponse;

interface ManifestEntry {
  fileId: string;
  modifiedTime: string;
  manifest: StoredManifest;
}

const gameFolderPath = (gameId: CreateSnapshotInput["gameId"]) =>
  `${gameId.shop}/${gameId.objectId}`;

const ensureGameFolderId = async (
  gameId: CreateSnapshotInput["gameId"]
): Promise<string> => {
  const { gamesId } = await ensureRootStructure();
  const shopFolderId = await ensureFolder(gameId.shop, gamesId);
  return ensureFolder(gameId.objectId, shopFolderId);
};

const findManifestEntry = async (
  gameId: CreateSnapshotInput["gameId"]
): Promise<ManifestEntry | null> => {
  const gameFolderId = await ensureGameFolderId(gameId);
  const entry = await findChildByName(gameFolderId, MANIFEST_FILE_NAME);
  if (!entry) return null;

  const manifest = await readFileJson<StoredManifest>(entry.id);
  return {
    fileId: entry.id,
    modifiedTime: entry.modifiedTime ?? new Date().toISOString(),
    manifest,
  };
};

const toSnapshotSummary = (entry: ManifestEntry): RemoteSnapshotSummary => ({
  id: entry.fileId,
  version: entry.manifest.snapshot.version,
  createdAt: entry.modifiedTime,
  updatedAt: entry.modifiedTime,
  fileCount: entry.manifest.files.length,
  totalSizeBytes: entry.manifest.files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  ),
  aggregateHash: buildCloudSaveAggregateHash({
    variants: entry.manifest.variants,
    files: entry.manifest.files,
  }),
});

const resolveSourcePathMap = (
  input: CreateSnapshotInput
): Map<string, string> => {
  const sources = new Map<string, string>();

  if (input.context) {
    for (const source of input.context.sourceFiles) {
      sources.set(cloudSaveFileKey(source), source.absolutePath);
    }
  } else if (input.getSourcePath) {
    for (const file of input.files) {
      const source = input.getSourcePath(file);
      if (source) sources.set(cloudSaveFileKey(file), source);
    }
  }

  return sources;
};

export const googleDriveStore: CloudSaveRemoteStore = {
  provider: "google-drive",

  async listSnapshot(gameId) {
    const entry = await findManifestEntry(gameId);
    if (!entry) return null;
    return toSnapshotSummary(entry);
  },

  async createSnapshot(input): Promise<CommitSnapshotResponse> {
    assertCloudSaveUploadWithinLimits(input.files);

    const { objectId, shop } = input.gameId;
    const sources = resolveSourcePathMap(input);
    const gameFolderId = await ensureGameFolderId(input.gameId);

    // Optimistic versioning: the commit must observe baseVersion.
    const existing = await findManifestEntry(input.gameId);
    if (existing && existing.manifest.snapshot.version !== input.baseVersion) {
      throw new Error("cloud_save_snapshot_version_conflict");
    }

    // Dedupe blobs by content hash — across files, versions and games.
    const uniqueBlobs = new Map<
      string,
      { file: SnapshotFile; sourcePath: string; coveredFiles: number }
    >();
    for (const file of input.files) {
      const key = blobKey(file);
      const existingBlob = uniqueBlobs.get(key);
      if (existingBlob) {
        existingBlob.coveredFiles += 1;
        continue;
      }
      const sourcePath = sources.get(cloudSaveFileKey(file));
      if (!sourcePath) {
        throw new Error(`cloud_save_source_file_unavailable:${file.hash}`);
      }
      uniqueBlobs.set(key, { file, sourcePath, coveredFiles: 1 });
    }

    const { blobsId } = await ensureRootStructure();
    const totalBytes = input.files.reduce(
      (total, file) => total + file.sizeBytes,
      0
    );
    const totalFiles = input.files.length;

    let completedFiles = 0;
    let completedBytes = 0;
    const reportProgress = (blob: {
      file: SnapshotFile;
      coveredFiles: number;
    }) => {
      completedFiles += blob.coveredFiles;
      completedBytes += blob.file.sizeBytes;
      input.onProgress?.({
        completedFiles: Math.min(completedFiles, totalFiles),
        totalFiles,
        completedBytes: Math.min(completedBytes, totalBytes),
        totalBytes,
        currentFile: blob.file.relativePath,
      });
    };

    await mapWithConcurrency(
      [...uniqueBlobs.values()],
      MAX_CONCURRENT_DRIVE_UPLOADS,
      async (blob) => {
        const name = blobFileName(blob.file.hash);
        const existingBlob = await findChildByName(blobsId, name);
        if (!existingBlob) {
          const stat = await fs.promises.stat(blob.sourcePath);
          if (stat.size !== blob.file.sizeBytes) {
            throw new Error(
              `cloud_save_source_file_changed:${blob.file.relativePath}`
            );
          }
          await uploadFile({
            name,
            parentId: blobsId,
            mimeType: BLOB_MIME,
            appProperties: { sha256: blob.file.hash },
            sourcePath: blob.sourcePath,
          });
          logger.log(`Uploaded Drive blob ${name}`);
        } else {
          logger.log(`Drive blob ${name} already present (deduped)`);
        }
        reportProgress(blob);
      }
    );

    const version = input.baseVersion + 1;

    if (existing) {
      await updateFileContent(
        existing.fileId,
        Buffer.from(
          JSON.stringify({
            snapshot: {
              shop,
              objectId,
              id: existing.fileId,
              version,
            },
            customPathRawPaths: input.customPathRawPaths,
            variants: input.variants,
            files: input.files,
          } satisfies StoredManifest)
        )
      );

      return {
        snapshotId: existing.fileId,
        version,
        fileCount: totalFiles,
        totalSizeBytes: totalBytes,
        aggregateHash: input.snapshotHash,
      };
    }

    // Create the manifest file first to learn its id, then fill the content.
    const manifestFileId = await uploadFile({
      name: MANIFEST_FILE_NAME,
      parentId: gameFolderId,
      mimeType: "application/json",
      appProperties: { shop, objectId, version: String(version) },
      content: Buffer.alloc(0),
    });

    await updateFileContent(
      manifestFileId,
      Buffer.from(
        JSON.stringify({
          snapshot: {
            shop,
            objectId,
            id: manifestFileId,
            version,
          },
          customPathRawPaths: input.customPathRawPaths,
          variants: input.variants,
          files: input.files,
        } satisfies StoredManifest)
      )
    );

    return {
      snapshotId: manifestFileId,
      version,
      fileCount: totalFiles,
      totalSizeBytes: totalBytes,
      aggregateHash: input.snapshotHash,
    };
  },

  async getRestoreManifest(gameId) {
    const entry = await findManifestEntry(gameId);
    if (!entry) throw new Error("cloud_save_remote_snapshot_not_found");
    return validateRestoreManifest(entry.manifest);
  },

  async downloadRestoreBlobs(
    input: DownloadRestoreBlobsInput
  ): Promise<DownloadedRestoreFile[]> {
    const files = input.requestedFiles ?? input.manifest.files;
    if (files.length === 0) return [];

    const { blobsId } = await ensureRootStructure();
    const tempDir = path.join(
      SystemPath.getPath("temp"),
      "hydra-plus-drive",
      `${input.manifest.snapshot.id}-${input.manifest.snapshot.version}`
    );
    await fs.promises.mkdir(tempDir, { recursive: true });

    const filesByBlob = new Map<string, typeof files>();
    for (const file of files) {
      const key = blobKey(file);
      filesByBlob.set(key, [...(filesByBlob.get(key) ?? []), file]);
    }

    let processedFiles = 0;
    const totalFiles = files.length;

    const groups = await mapWithConcurrency(
      [...filesByBlob.values()],
      MAX_CONCURRENT_DRIVE_DOWNLOADS,
      async (group) => {
        const [lead] = group;
        const destinationPath = path.join(tempDir, blobFileName(lead.hash));
        const blobEntry = await findChildByName(
          blobsId,
          blobFileName(lead.hash)
        );
        if (!blobEntry) {
          throw new Error(`cloud_save_remote_blob_missing:${lead.hash}`);
        }

        await downloadFileToFile(blobEntry.id, destinationPath);

        processedFiles += group.length;
        input.onProgress?.(Math.min(processedFiles, totalFiles), totalFiles);

        return group.map((file) => ({ ...file, tempPath: destinationPath }));
      }
    );

    return groups.flat();
  },

  async deleteGameCloudData(gameId) {
    resetFolderStructureCache();
    const entry = await findManifestEntry(gameId);
    if (!entry) return;
    await trashFile(entry.fileId);
    // Blobs are intentionally kept: they are content-addressed and may be
    // shared by other snapshots. A garbage-collector can sweep unreferenced
    // blobs later (see docs/google-drive-cloud.md).
    logger.log(`Trashed Drive manifest for ${gameFolderPath(gameId)}`);
  },
};
