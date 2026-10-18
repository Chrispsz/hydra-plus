import fs from "node:fs";
import path from "node:path";

import type { ProtonInstallProgress, ProtonRelease } from "@types";

import { getAssetFileNameFromDownloadUrl } from "./github-release-parsing.js";
import {
  createStagingDir,
  inspectStagedProton,
  promoteStagedProton,
  type ProtonInstallMetadata,
} from "./install-transaction.js";
import { verifyProtonArchive } from "./verification.js";

/**
 * The install pipeline coordinator: download → verify → extract →
 * validate → promote → metadata. Every side-effectful step is an
 * injected dependency, so the whole flow is testable with temp
 * directories and fake download/extract steps (no network).
 */

export const PROTON_INSTALL_MIN_PROGRESS_INTERVAL_MS = 200;

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new Error("canceled");
};

export interface ProtonInstallJobDeps {
  downloadArchive: (options: {
    url: string;
    destinationPath: string;
    signal: AbortSignal;
    onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
  }) => Promise<void>;
  extractArchive: (options: {
    archivePath: string;
    destinationDir: string;
    signal: AbortSignal;
  }) => Promise<void>;
}

export interface ProtonInstallJobOptions {
  providerId: string;
  release: ProtonRelease;
  /** compatibilitytools.d directory that receives the build. */
  targetDir: string;
  /** Scratch directory for the downloaded archive. */
  workspaceDir: string;
  deps: ProtonInstallJobDeps;
  signal: AbortSignal;
  onProgress: (payload: ProtonInstallProgress) => void;
}

export const runProtonInstallJob = async (
  options: ProtonInstallJobOptions
): Promise<void> => {
  const { providerId, release, targetDir, workspaceDir, deps, signal } =
    options;

  const assetName = getAssetFileNameFromDownloadUrl(release.downloadUrl);
  if (!assetName) {
    throw new Error("proton_release_invalid_asset_url");
  }

  const archivePath = path.join(workspaceDir, assetName);
  let stagingDir: string | null = null;

  const emitPhase = (
    phase: ProtonInstallProgress["phase"],
    extra?: Partial<ProtonInstallProgress>
  ) => {
    options.onProgress({ providerId, tag: release.tag, phase, ...extra });
  };

  try {
    await fs.promises.mkdir(workspaceDir, { recursive: true });
    throwIfAborted(signal);

    emitPhase("downloading", {
      totalBytes: release.sizeBytes > 0 ? release.sizeBytes : undefined,
    });
    await deps.downloadArchive({
      url: release.downloadUrl,
      destinationPath: archivePath,
      signal,
      onProgress: (receivedBytes, totalBytes) => {
        emitPhase("downloading", {
          receivedBytes,
          totalBytes: totalBytes ?? undefined,
        });
      },
    });
    throwIfAborted(signal);

    emitPhase("verifying");
    const verification = await verifyProtonArchive(archivePath, release);
    if (!verification.ok) {
      await fs.promises.rm(archivePath, { force: true }).catch(() => {});
      throw new Error(verification.error ?? "proton_verification_failed");
    }
    throwIfAborted(signal);

    emitPhase("extracting");
    stagingDir = await createStagingDir(targetDir);
    await deps.extractArchive({
      archivePath,
      destinationDir: stagingDir,
      signal,
    });
    throwIfAborted(signal);

    const { releaseDirName } = inspectStagedProton(stagingDir);
    throwIfAborted(signal);

    emitPhase("promoting");
    const metadata: ProtonInstallMetadata = {
      provider: providerId,
      tag: release.tag,
      assetName,
      installedAt: new Date().toISOString(),
    };
    await promoteStagedProton({
      stagingDir,
      releaseDirName,
      targetDir,
      metadata,
    });

    await cleanupJobArtifacts(workspaceDir, stagingDir);
    stagingDir = null;

    emitPhase("done");
  } catch (error) {
    if (stagingDir !== null) {
      await fs.promises
        .rm(stagingDir, { recursive: true, force: true })
        .catch(() => {});
    }
    await fs.promises
      .rm(workspaceDir, { recursive: true, force: true })
      .catch(() => {});
    throw error;
  }
};

/**
 * Success-path cleanup: the staging directory (leftover after the
 * promote rename) and the workspace holding the archive. All
 * best-effort — the build is already installed at this point.
 */
const cleanupJobArtifacts = async (
  workspaceDir: string,
  stagingDir: string
): Promise<void> => {
  await fs.promises
    .rm(workspaceDir, { recursive: true, force: true })
    .catch(() => {});
  await fs.promises
    .rm(stagingDir, { recursive: true, force: true })
    .catch(() => {});
};
