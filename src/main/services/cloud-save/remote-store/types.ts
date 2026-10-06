import type {
  CloudSaveGameId,
  CloudSaveUploadProgress,
  CommitSnapshotResponse,
  DownloadedRestoreFile,
  LocalGameSnapshotContext,
  RemoteSnapshotSummary,
  RestoreManifestFile,
  RestoreManifestResponse,
  SnapshotFile,
  SnapshotVariant,
} from "@types";
import type { CloudStorageProvider } from "@types";

/**
 * A remote storage provider for the cloud-save v2 engine.
 *
 * The whole sync engine (analysis, three-way merge, sync anchors, restore
 * planning, deletion state machine) operates purely on the manifest/hash
 * model and never talks to the network directly. Everything that touches a
 * remote backend goes through this interface, so the engine is indifferent
 * to whether snapshots live on the Hydra API (subscription) or on the
 * user's own Google Drive (personal, free).
 */
export interface CloudSaveRemoteStore {
  readonly provider: CloudStorageProvider;

  /** Returns the single active snapshot for a game, or null. */
  listSnapshot(gameId: CloudSaveGameId): Promise<RemoteSnapshotSummary | null>;

  /**
   * Creates the next snapshot (baseVersion + 1) from local state.
   * Implementations own the whole transport: dedupe, blob upload,
   * manifest write and optimistic versioning.
   */
  createSnapshot(input: CreateSnapshotInput): Promise<CommitSnapshotResponse>;

  /** Fetches the restore manifest of the active snapshot. */
  getRestoreManifest(
    gameId: CloudSaveGameId
  ): Promise<RestoreManifestResponse>;

  /**
   * Downloads the blobs referenced by (a subset of) a restore manifest into
   * temporary files and returns one entry per manifest file.
   */
  downloadRestoreBlobs(
    input: DownloadRestoreBlobsInput
  ): Promise<DownloadedRestoreFile[]>;

  /** Removes all remote cloud-save data of a game. Local cleanup is the caller's job. */
  deleteGameCloudData(gameId: CloudSaveGameId): Promise<void>;
}

export interface CreateSnapshotInput {
  gameId: CloudSaveGameId;
  platform: "windows" | "linux" | "mac";
  hostname?: string;
  /** Canonical aggregate hash of {variants, files}. */
  snapshotHash: string;
  /** Must match the currently stored version (0 for first sync). */
  baseVersion: number;
  retroArchFormatVersion?: 2;
  customPathRawPaths: string[];
  variants: SnapshotVariant[];
  files: SnapshotFile[];
  /**
   * Snapshot context produced by the local snapshot pipeline. Providers use
   * it to locate the absolute path of each file that needs upload.
   */
  context?: LocalGameSnapshotContext;
  /** Alternative to `context` for providers that need per-file sources. */
  getSourcePath?: (file: SnapshotFile) => string | null;
  onProgress?: (progress: CloudSaveUploadProgress) => void;
}

export interface DownloadRestoreBlobsInput {
  manifest: RestoreManifestResponse;
  /** When omitted, every manifest file is downloaded. */
  requestedFiles?: RestoreManifestFile[];
  onProgress?: (processedFiles: number, totalFiles: number) => void;
}
