import fs from "node:fs";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { SystemPath } from "@main/services/system-path";
import { logger } from "@main/services/logger";
import { db, levelKeys } from "@main/level";
import type {
  CommitSnapshotResponse,
  DriveCleanupResult,
  DriveHygieneOverview,
  DownloadedRestoreFile,
  RemoteSnapshotSummary,
  RestoreManifestFile,
  RestoreManifestResponse,
  SnapshotFile,
  SnapshotVersionSummary,
  UserPreferences,
} from "@types";

import {
  cloudSaveFileKey,
  validateRestoreManifest,
} from "./../../cloud-save-contract";
import { mapWithConcurrency } from "./../../map-with-concurrency";
import { buildCloudSaveAggregateHash } from "./../../snapshot-aggregate-hash";
import { assertCloudSaveUploadWithinLimits } from "./../../upload-limits";
import { verifyDownloadedRestoreFile } from "./../../verify-downloaded-restore-file";
import type {
  CloudSaveRemoteStore,
  CreateSnapshotInput,
  DownloadRestoreBlobsInput,
} from "./../types";
import {
  deleteFileForever,
  downloadFileToFile,
  ensureFolder,
  ensureRootStructure,
  findChildByName,
  listAllChildren,
  listAllTrashedFiles,
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
 *     blobs/<sha256>.blob         ← content-addressed pool, dedup across games
 *     blobs/<sha256>.blob.gz      ← gzip-encoded variant (text-ish saves)
 *     games/<shop>/<objectId>/
 *       manifest.json             ← current head: RestoreManifestResponse
 *       history/<version>.json    ← per-version registry (small JSON each)
 *
 * Version manifests reference the SAME content-addressed blob pool, so
 * keeping history costs only a few KB per version. The current manifest is
 * still the source of truth for the sync engine; history is additive.
 *
 * Blob dedupe happens by filename (= sha256 + encoding suffix). Optimistic
 * versioning follows the same contract the sync engine expects: a commit
 * must observe baseVersion on disk, otherwise the caller retries with the
 * standard re-prepare policy.
 */

const MANIFEST_FILE_NAME = "manifest.json";
const HISTORY_FOLDER_NAME = "history";
const DEFAULT_VERSION_RETENTION = 20;
const MIN_VERSION_RETENTION = 3;
const MAX_VERSION_RETENTION = 200;
const MAX_CONCURRENT_DRIVE_UPLOADS = 4;
const MAX_CONCURRENT_DRIVE_DOWNLOADS = 4;
const BLOB_MIME = "application/octet-stream";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Extensions whose content benefits from gzip before upload. */
const COMPRESSIBLE_EXTENSIONS = new Set([
  ".json",
  ".xml",
  ".ini",
  ".cfg",
  ".conf",
  ".txt",
  ".log",
  ".vdf",
  ".vl2",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".html",
  ".htm",
  ".js",
  ".lua",
  ".py",
  ".sav2", // text-ish save formats
  ".profile",
  ".props",
]);
const GZIP_MIN_SIZE_BYTES = 8 * 1024;
const GZIP_MAX_SIZE_BYTES = 256 * 1024 * 1024;

const blobFileName = (hash: string) => `${hash}.blob`;
const gzipBlobFileName = (hash: string) => `${hash}.blob.gz`;
const blobKey = (file: Pick<SnapshotFile, "hash" | "sizeBytes">) =>
  JSON.stringify([file.hash, file.sizeBytes]);

const isGzipEncoding = (
  encodings: Record<string, "gzip"> | undefined,
  file: Pick<SnapshotFile, "hash" | "sizeBytes">
) => encodings?.[cloudSaveFileKey(file as SnapshotFile)] === "gzip";

const shouldCompressFile = async (
  sourcePath: string,
  sizeBytes: number
): Promise<boolean> => {
  if (sizeBytes < GZIP_MIN_SIZE_BYTES || sizeBytes > GZIP_MAX_SIZE_BYTES) {
    return false;
  }
  const extension = path.extname(sourcePath).toLowerCase();
  return COMPRESSIBLE_EXTENSIONS.has(extension);
};

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

interface HistoryEntry {
  fileId: string;
  version: number;
  modifiedTime: string;
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

const ensureHistoryFolderId = async (gameFolderId: string): Promise<string> =>
  ensureFolder(HISTORY_FOLDER_NAME, gameFolderId);

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

const toVersionSummary = (
  manifest: StoredManifest,
  versionFileId: string,
  savedAt: string,
  currentHeadVersion: number
): SnapshotVersionSummary => ({
  id: versionFileId,
  version: manifest.snapshot.version,
  savedAt,
  fileCount: manifest.files.length,
  totalSizeBytes: manifest.files.reduce(
    (total, file) => total + file.sizeBytes,
    0
  ),
  aggregateHash: buildCloudSaveAggregateHash({
    variants: manifest.variants,
    files: manifest.files,
  }),
  current: manifest.snapshot.version === currentHeadVersion,
});

const parseVersionFileName = (name: string): number | null => {
  const match = /^(\d+)\.json$/.exec(name);
  return match ? Number(match[1]) : null;
};

/** Lists the game's history files (unsorted). */
const listHistoryEntries = async (
  gameId: CreateSnapshotInput["gameId"]
): Promise<HistoryEntry[]> => {
  const gameFolderId = await ensureGameFolderId(gameId);
  const historyFolder = await findChildByName(
    gameFolderId,
    HISTORY_FOLDER_NAME
  );
  if (
    !historyFolder ||
    historyFolder.mimeType !== "application/vnd.google-apps.folder"
  ) {
    return [];
  }
  const children = await listAllChildren(historyFolder.id);
  const entries: HistoryEntry[] = [];
  for (const child of children) {
    const version = parseVersionFileName(child.name);
    if (version !== null) {
      entries.push({
        fileId: child.id,
        version,
        modifiedTime: child.modifiedTime ?? new Date().toISOString(),
      });
    }
  }
  return entries;
};

const readHistoryManifest = async (
  entry: HistoryEntry
): Promise<StoredManifest> => {
  const payload = await readFileJson<{
    savedAt?: string;
    manifest?: StoredManifest;
  }>(entry.fileId);
  if (!payload?.manifest) {
    throw new Error(`cloud_save_history_manifest_corrupt:${entry.version}`);
  }
  return payload.manifest;
};

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

const resolveSnapshotRetention = async (): Promise<number> => {
  try {
    const preferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );
    const configured = preferences?.cloudSaveSnapshotRetention;
    if (
      typeof configured === "number" &&
      Number.isSafeInteger(configured) &&
      configured >= MIN_VERSION_RETENTION
    ) {
      return Math.min(configured, MAX_VERSION_RETENTION);
    }
  } catch (error) {
    logger.warn("Failed to read snapshot retention preference", error);
  }
  return DEFAULT_VERSION_RETENTION;
};

/** Trashes history manifests beyond the retention window (oldest first). */
const pruneOldVersions = async (
  gameId: CreateSnapshotInput["gameId"],
  currentHeadVersion: number
): Promise<void> => {
  try {
    const retention = await resolveSnapshotRetention();
    const entries = await listHistoryEntries(gameId);
    const deletable = entries
      .filter((entry) => entry.version !== currentHeadVersion)
      .sort((left, right) => left.version - right.version);

    const excess = deletable.length - (retention - 1);
    for (let index = 0; index < excess; index += 1) {
      const entry = deletable[index];
      await trashFile(entry.fileId).catch(() => undefined);
      logger.log(
        `Pruned old Drive snapshot version ${entry.version} of ${gameFolderPath(gameId)}`
      );
    }
  } catch (error) {
    logger.warn("Failed to prune old snapshot versions", error);
  }
};

const collectReferencedBlobHashes = async (): Promise<Set<string>> => {
  const referenced = new Set<string>();
  const { gamesId } = await ensureRootStructure();
  const shopFolders = await listAllChildren(gamesId);
  for (const shopFolder of shopFolders) {
    if (shopFolder.mimeType !== "application/vnd.google-apps.folder") continue;
    const gameFolders = await listAllChildren(shopFolder.id);
    for (const gameFolder of gameFolders) {
      if (gameFolder.mimeType !== "application/vnd.google-apps.folder")
        continue;

      const currentManifest = await findChildByName(
        gameFolder.id,
        MANIFEST_FILE_NAME
      ).catch(() => null);
      if (currentManifest) {
        const manifest = await readFileJson<StoredManifest>(
          currentManifest.id
        ).catch(() => null);
        if (manifest) {
          for (const file of manifest.files) referenced.add(file.hash);
        }
      }

      const historyFolder = await findChildByName(
        gameFolder.id,
        HISTORY_FOLDER_NAME
      ).catch(() => null);
      if (historyFolder?.mimeType === "application/vnd.google-apps.folder") {
        const children = await listAllChildren(historyFolder.id).catch(
          () => []
        );
        for (const child of children) {
          if (parseVersionFileName(child.name) === null) continue;
          const payload = await readFileJson<{
            manifest?: StoredManifest;
          }>(child.id).catch(() => null);
          if (!payload?.manifest) continue;
          for (const file of payload.manifest.files) {
            referenced.add(file.hash);
          }
        }
      }
    }
  }
  return referenced;
};

const downloadManifestBlobsToTemp = async (
  manifest: RestoreManifestResponse,
  requestedFiles?: RestoreManifestFile[],
  onProgress?: (processedFiles: number, totalFiles: number) => void
): Promise<DownloadedRestoreFile[]> => {
  const files = requestedFiles ?? manifest.files;
  if (files.length === 0) return [];

  const { blobsId } = await ensureRootStructure();
  const tempDir = path.join(
    SystemPath.getPath("temp"),
    "hydra-plus-drive",
    `${manifest.snapshot.id}-${manifest.snapshot.version}`
  );
  await fs.promises.mkdir(tempDir, { recursive: true });

  const encodings = manifest.blobEncodings;
  const filesByBlob = new Map<string, SnapshotFile[]>();
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
      const useGzip = isGzipEncoding(encodings, lead);
      const remoteName = useGzip
        ? gzipBlobFileName(lead.hash)
        : blobFileName(lead.hash);
      const destinationPath = path.join(tempDir, remoteName);
      const blobEntry = await findChildByName(blobsId, remoteName);
      if (!blobEntry) {
        throw new Error(`cloud_save_remote_blob_missing:${lead.hash}`);
      }

      await downloadFileToFile(blobEntry.id, destinationPath);

      processedFiles += group.length;
      onProgress?.(Math.min(processedFiles, totalFiles), totalFiles);

      return group.map((file) => ({ ...file, tempPath: destinationPath }));
    }
  );

  return groups.flat();
};

const extractDownloadedBlob = async (
  tempPath: string,
  targetPath: string,
  encoding: "raw" | "gzip"
): Promise<void> => {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  if (encoding === "raw") {
    await fs.promises.copyFile(tempPath, targetPath);
    return;
  }
  const compressed = await fs.promises.readFile(tempPath);
  const raw = await gunzipAsync(compressed);
  await fs.promises.writeFile(targetPath, raw);
};

const getSnapshotVersionManifest = async (
  gameId: CreateSnapshotInput["gameId"],
  version: number
): Promise<RestoreManifestResponse> => {
  const head = await findManifestEntry(gameId);
  if (head?.manifest.snapshot.version === version) {
    return validateRestoreManifest(head.manifest);
  }

  const historyEntries = await listHistoryEntries(gameId);
  const entry = historyEntries.find(
    (candidate) => candidate.version === version
  );
  if (!entry) throw new Error("cloud_save_remote_snapshot_not_found");

  const manifest = await readHistoryManifest(entry);
  return validateRestoreManifest(manifest);
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
      {
        file: SnapshotFile;
        sourcePath: string;
        coveredFiles: number;
        compress: boolean;
      }
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
      uniqueBlobs.set(key, {
        file,
        sourcePath,
        coveredFiles: 1,
        compress: await shouldCompressFile(sourcePath, file.sizeBytes),
      });
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

    /** file key → "gzip" for blobs stored compressed. */
    const gzipEncodings: Record<string, "gzip"> = {};

    await mapWithConcurrency(
      [...uniqueBlobs.values()],
      MAX_CONCURRENT_DRIVE_UPLOADS,
      async (blob) => {
        const encoding: "raw" | "gzip" = blob.compress ? "gzip" : "raw";
        const name =
          encoding === "gzip"
            ? gzipBlobFileName(blob.file.hash)
            : blobFileName(blob.file.hash);
        const existingBlob = await findChildByName(blobsId, name);
        if (!existingBlob) {
          const stat = await fs.promises.stat(blob.sourcePath);
          if (stat.size !== blob.file.sizeBytes) {
            throw new Error(
              `cloud_save_source_file_changed:${blob.file.relativePath}`
            );
          }
          if (encoding === "gzip") {
            const raw = await fs.promises.readFile(blob.sourcePath);
            const compressed = await gzipAsync(raw);
            await uploadFile({
              name,
              parentId: blobsId,
              mimeType: BLOB_MIME,
              appProperties: { sha256: blob.file.hash },
              content: compressed,
            });
          } else {
            await uploadFile({
              name,
              parentId: blobsId,
              mimeType: BLOB_MIME,
              appProperties: { sha256: blob.file.hash },
              sourcePath: blob.sourcePath,
            });
          }
          logger.log(`Uploaded Drive blob ${name}`);
        } else {
          logger.log(`Drive blob ${name} already present (deduped)`);
        }
        if (encoding === "gzip") {
          gzipEncodings[cloudSaveFileKey(blob.file)] = "gzip";
        }
        reportProgress(blob);
      }
    );

    const version = input.baseVersion + 1;

    const manifestContent = (manifestFileId: string) =>
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
          ...(Object.keys(gzipEncodings).length > 0
            ? { blobEncodings: gzipEncodings }
            : {}),
        } satisfies StoredManifest)
      );

    let manifestFileId: string;
    if (existing) {
      manifestFileId = existing.fileId;
      await updateFileContent(manifestFileId, manifestContent(manifestFileId));
    } else {
      // Create the manifest file first to learn its id, then fill the content.
      manifestFileId = await uploadFile({
        name: MANIFEST_FILE_NAME,
        parentId: gameFolderId,
        mimeType: "application/json",
        appProperties: { shop, objectId, version: String(version) },
        content: Buffer.alloc(0),
      });
      await updateFileContent(manifestFileId, manifestContent(manifestFileId));
    }

    // Register the version in the history folder (best-effort: an eventual
    // consistency hiccup must not fail the sync).
    try {
      const historyFolderId = await ensureHistoryFolderId(gameFolderId);
      const existingHistory = await findChildByName(
        historyFolderId,
        `${version}.json`
      );
      const historyPayload = Buffer.from(
        JSON.stringify({
          savedAt: new Date().toISOString(),
          manifest: JSON.parse(manifestContent(manifestFileId).toString()),
        })
      );
      if (existingHistory) {
        await updateFileContent(existingHistory.id, historyPayload);
      } else {
        await uploadFile({
          name: `${version}.json`,
          parentId: historyFolderId,
          mimeType: "application/json",
          content: historyPayload,
        });
      }
    } catch (error) {
      logger.warn("Failed to register snapshot history entry", error);
    }

    void pruneOldVersions(input.gameId, version);

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
    return downloadManifestBlobsToTemp(
      input.manifest,
      input.requestedFiles,
      input.onProgress
    );
  },

  async deleteGameCloudData(gameId) {
    resetFolderStructureCache();
    const gameFolderId = await ensureGameFolderId(gameId);

    // Trash the manifest AND the whole history folder — the user asked for
    // "delete cloud data" to leave no leftovers behind.
    const manifest = await findChildByName(gameFolderId, MANIFEST_FILE_NAME);
    if (manifest) await trashFile(manifest.id);

    const historyFolder = await findChildByName(
      gameFolderId,
      HISTORY_FOLDER_NAME
    );
    if (
      historyFolder &&
      historyFolder.mimeType === "application/vnd.google-apps.folder"
    ) {
      const children = await listAllChildren(historyFolder.id).catch(() => []);
      for (const child of children) {
        await trashFile(child.id).catch(() => undefined);
      }
      await trashFile(historyFolder.id).catch(() => undefined);
    }

    // Blobs are intentionally kept: they are content-addressed and may be
    // shared by other snapshots. The hygiene GC sweeps unreferenced blobs.
    logger.log(`Trashed Drive manifest for ${gameFolderPath(gameId)}`);
  },

  async listSnapshotVersions(gameId) {
    const head = await findManifestEntry(gameId);
    const headVersion = head?.manifest.snapshot.version ?? 0;

    const versions: SnapshotVersionSummary[] = [];
    const seenVersions = new Set<number>();

    const historyEntries = await listHistoryEntries(gameId);
    for (const entry of historyEntries) {
      try {
        const manifest = await readHistoryManifest(entry);
        seenVersions.add(manifest.snapshot.version);
        versions.push(
          toVersionSummary(
            manifest,
            entry.fileId,
            entry.modifiedTime,
            headVersion
          )
        );
      } catch (error) {
        logger.warn(
          `Skipping unreadable history version ${entry.version}`,
          error
        );
      }
    }

    // Backwards compatibility: a pre-history snapshot has its head manifest
    // but no history entry yet — synthesize it so the head is always listed.
    if (head && !seenVersions.has(headVersion)) {
      versions.push(
        toVersionSummary(
          head.manifest,
          head.fileId,
          head.modifiedTime,
          headVersion
        )
      );
    }

    return versions.sort((left, right) => left.version - right.version);
  },

  async getSnapshotVersionManifest(gameId, version) {
    return getSnapshotVersionManifest(gameId, version);
  },

  async deleteSnapshotVersion(gameId, version) {
    const head = await findManifestEntry(gameId);
    if (head?.manifest.snapshot.version === version) {
      throw new Error("cloud_save_cannot_delete_current_version");
    }

    const historyEntries = await listHistoryEntries(gameId);
    const entry = historyEntries.find(
      (candidate) => candidate.version === version
    );
    if (!entry) throw new Error("cloud_save_remote_snapshot_not_found");

    await trashFile(entry.fileId);
    logger.log(
      `Trashed Drive snapshot version ${version} of ${gameFolderPath(gameId)}`
    );
  },

  async downloadSnapshotVersionToFolder(
    gameId,
    version,
    destinationFolder,
    onProgress
  ) {
    const manifest = await getSnapshotVersionManifest(gameId, version);
    const files = manifest.files;
    if (files.length === 0) {
      return { fileCount: 0, totalSizeBytes: 0 };
    }

    await fs.promises.mkdir(destinationFolder, { recursive: true });

    const variantFolders = new Map<string, string>();
    if (manifest.variants.length === 1) {
      variantFolders.set(manifest.variants[0].variantId, "");
    } else {
      for (const variant of manifest.variants) {
        const label =
          variant.kind === "default"
            ? "default"
            : variant.kind === "steam-account" && variant.steamId64
              ? `steam-${variant.steamId64}`
              : `folder-${variant.variantId.slice(0, 8)}`;
        variantFolders.set(variant.variantId, label);
      }
    }

    const downloaded = await downloadManifestBlobsToTemp(manifest);
    const tempDir = path.dirname(downloaded[0].tempPath);

    try {
      let processed = 0;
      const total = downloaded.length;
      await mapWithConcurrency(
        downloaded,
        MAX_CONCURRENT_DRIVE_DOWNLOADS,
        async (entry) => {
          const integrity = await verifyDownloadedRestoreFile({
            tempPath: entry.tempPath,
            expectedHash: entry.hash,
          });
          if (!integrity.ok) {
            throw new Error("Downloaded snapshot integrity check failed");
          }

          const variantFolder =
            variantFolders.get(entry.variantId) ?? "default";
          const targetPath = path.join(
            destinationFolder,
            variantFolder,
            entry.relativePath
          );
          await extractDownloadedBlob(
            entry.tempPath,
            targetPath,
            manifest.blobEncodings?.[cloudSaveFileKey(entry)] === "gzip"
              ? "gzip"
              : "raw"
          );

          processed += 1;
          return entry;
        },
        () => {
          onProgress?.(Math.min(processed, total), total);
        }
      );
      return {
        fileCount: processed,
        totalSizeBytes: files.reduce(
          (total, file) => total + file.sizeBytes,
          0
        ),
      };
    } finally {
      await fs.promises
        .rm(tempDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  },

  async getDriveHygieneOverview(): Promise<DriveHygieneOverview> {
    const { rootId, blobsId } = await ensureRootStructure();

    const blobFiles = await listAllChildren(blobsId);
    let blobBytes = 0;
    for (const blob of blobFiles) {
      blobBytes += Number(blob.size ?? 0);
    }

    const rootChildren = await listAllChildren(rootId);
    const gamesFolder = rootChildren.find(
      (child) =>
        child.name === "games" &&
        child.mimeType === "application/vnd.google-apps.folder"
    );
    let versionCount = 0;
    let gameCount = 0;
    let manifestBytes = 0;
    const referenced = await collectReferencedBlobHashes();

    if (gamesFolder) {
      const shopFolders = await listAllChildren(gamesFolder.id);
      for (const shopFolder of shopFolders) {
        if (shopFolder.mimeType !== "application/vnd.google-apps.folder")
          continue;
        const gameFolders = await listAllChildren(shopFolder.id);
        for (const gameFolder of gameFolders) {
          if (gameFolder.mimeType !== "application/vnd.google-apps.folder")
            continue;
          gameCount += 1;
          const gameChildren = await listAllChildren(gameFolder.id).catch(
            () => []
          );
          const manifest = gameChildren.find(
            (child) => child.name === MANIFEST_FILE_NAME
          );
          if (manifest) manifestBytes += Number(manifest.size ?? 0);
          const historyFolder = gameChildren.find(
            (child) =>
              child.name === HISTORY_FOLDER_NAME &&
              child.mimeType === "application/vnd.google-apps.folder"
          );
          if (historyFolder) {
            const children = await listAllChildren(historyFolder.id).catch(
              () => []
            );
            versionCount += children.filter(
              (child) => parseVersionFileName(child.name) !== null
            ).length;
            for (const child of children) {
              manifestBytes += Number(child.size ?? 0);
            }
          }
        }
      }
    }

    let orphanBlobCount = 0;
    let orphanBlobBytes = 0;
    for (const blob of blobFiles) {
      const hash = blob.name.replace(/\.blob(\.gz)?$/, "");
      if (!referenced.has(hash)) {
        orphanBlobCount += 1;
        orphanBlobBytes += Number(blob.size ?? 0);
      }
    }

    const trashed = await listAllTrashedFiles();
    let trashedFileBytes = 0;
    for (const file of trashed) {
      trashedFileBytes += Number(file.size ?? 0);
    }

    return {
      versionCount,
      gameCount,
      blobCount: blobFiles.length,
      blobBytes,
      manifestBytes,
      orphanBlobCount,
      orphanBlobBytes,
      trashedFileCount: trashed.length,
      trashedFileBytes,
    };
  },

  async cleanupDriveTrash(): Promise<DriveCleanupResult> {
    const trashed = await listAllTrashedFiles();
    let freedBytes = 0;
    let deleted = 0;

    await mapWithConcurrency(
      trashed,
      MAX_CONCURRENT_DRIVE_DOWNLOADS,
      async (file) => {
        await deleteFileForever(file.id);
        freedBytes += Number(file.size ?? 0);
        deleted += 1;
      }
    );

    logger.log(`Drive trash cleanup removed ${deleted} files`);
    return { deletedFiles: deleted, freedBytes };
  },

  async deleteOrphanBlobs(): Promise<DriveCleanupResult> {
    const { blobsId } = await ensureRootStructure();
    const referenced = await collectReferencedBlobHashes();
    const blobFiles = await listAllChildren(blobsId);

    const orphans = blobFiles.filter((blob) => {
      const hash = blob.name.replace(/\.blob(\.gz)?$/, "");
      return !referenced.has(hash);
    });

    let freedBytes = 0;
    let deleted = 0;
    await mapWithConcurrency(
      orphans,
      MAX_CONCURRENT_DRIVE_DOWNLOADS,
      async (blob) => {
        await deleteFileForever(blob.id);
        freedBytes += Number(blob.size ?? 0);
        deleted += 1;
      }
    );

    logger.log(`Drive orphan GC removed ${deleted} blobs`);
    return { deletedFiles: deleted, freedBytes };
  },
};
