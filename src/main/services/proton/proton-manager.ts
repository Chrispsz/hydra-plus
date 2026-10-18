import fs from "node:fs";
import path from "node:path";

import type {
  ProtonInstallProgress,
  ProtonInstallTarget,
  ProtonProvider,
  ProtonRelease,
} from "@types";

import { appVersion } from "@main/constants";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import { WindowManager } from "@main/services/window-manager";
import { getSteamLibraryFolders } from "@main/services/steam";

import { downloadProtonArchive } from "./archive-download";
import { extractProtonArchive } from "./archive-extraction";
import { fetchGitHubReleasesPage } from "./github-release-source";
import {
  getCompatToolRoots,
  getProtonInstallTargetList,
  readExtraCompatToolPaths,
  resolveInstallTarget,
  validateProtonRemoval,
  type ProtonInstallTargetsInput,
} from "./install-targets";
import { isValidProtonDirectory } from "./install-transaction";
import {
  PROTON_INSTALL_MIN_PROGRESS_INTERVAL_MS,
  runProtonInstallJob,
  type ProtonInstallJobDeps,
} from "./install-job";
import { getProtonProviderById, toProtonProviderList } from "./providers";
import { ProtonReleaseCatalog } from "./release-catalog";
import { createProgressThrottle } from "./progress-throttle";

/**
 * Coordinator for the Proton build manager: provider registry, release
 * browsing, one-at-a-time installs with pushed progress, and safe
 * removal of installed builds.
 */

const PROTON_USER_AGENT = `Hydra/${appVersion}`;

const PROTON_ERROR_CODES = new Set([
  "canceled",
  "proton_rate_limited",
  "proton_network_error",
  "proton_unknown_provider",
  "proton_release_not_found",
  "proton_release_invalid_asset_url",
  "proton_download_canceled",
  "proton_download_stalled",
  "proton_download_headers_timeout",
  "proton_download_failed",
  "proton_verification_failed",
  "proton_verification_size_mismatch",
  "proton_verification_digest_mismatch",
  "proton_extraction_failed",
  "proton_extraction_aborted",
  "proton_extraction_unsupported_archive",
  "proton_invalid_archive_layout",
  "proton_promote_rollback_failed",
]);

const toProtonErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":")[0];
  return PROTON_ERROR_CODES.has(code) ? code : "proton_install_failed";
};

interface ActiveProtonJob {
  providerId: string;
  tag: string;
  controller: AbortController;
}

const REAL_INSTALL_JOB_DEPS: ProtonInstallJobDeps = {
  downloadArchive: ({ url, destinationPath, signal, onProgress }) =>
    downloadProtonArchive({
      url,
      destinationPath,
      signal,
      userAgent: PROTON_USER_AGENT,
      onProgress,
    }),
  extractArchive: extractProtonArchive,
};

export class ProtonManager {
  private static readonly catalog = new ProtonReleaseCatalog({
    fetchPage: fetchGitHubReleasesPage,
  });

  private static activeJob: ActiveProtonJob | null = null;

  public static getProviders(): ProtonProvider[] {
    return toProtonProviderList();
  }

  public static async getReleases(
    providerId: string,
    page = 1
  ): Promise<{ releases: ProtonRelease[]; hasMore: boolean }> {
    const provider = getProtonProviderById(providerId);
    if (!provider) throw new Error("proton_unknown_provider");

    return this.catalog.getReleases(provider, page);
  }

  private static async getTargetsInput(): Promise<ProtonInstallTargetsInput> {
    const libraryFolders = await getSteamLibraryFolders().catch(() => []);

    return {
      homePath: SystemPath.getPath("home"),
      libraryFolders,
      extraCompatToolPaths: readExtraCompatToolPaths(),
    };
  }

  public static async getInstallTargets(): Promise<ProtonInstallTarget[]> {
    if (process.platform !== "linux") return [];

    return getProtonInstallTargetList(await this.getTargetsInput());
  }

  /**
   * Starts an install job (one at a time). Resolves as soon as the job
   * is accepted; execution failures are reported through the
   * `on-proton-install-progress` channel with the "error" phase.
   */
  public static async installRelease(
    providerId: string,
    tag: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== "linux") {
      return { ok: false, error: "proton_linux_only" };
    }

    const provider = getProtonProviderById(providerId);
    if (!provider) return { ok: false, error: "proton_unknown_provider" };

    if (this.activeJob) return { ok: false, error: "proton_install_busy" };

    const job: ActiveProtonJob = {
      providerId: provider.id,
      tag,
      controller: new AbortController(),
    };
    this.activeJob = job;

    logger.info("Starting Proton install job", {
      providerId: provider.id,
      tag,
    });

    void this.executeInstallJob(job).catch((error) => {
      logger.error("Proton install job crashed unexpectedly", {
        providerId: job.providerId,
        tag: job.tag,
        error,
      });
    });

    return { ok: true };
  }

  private static async executeInstallJob(job: ActiveProtonJob): Promise<void> {
    const provider = getProtonProviderById(job.providerId);
    const sendProgress = createProgressThrottle({
      emit: (payload: ProtonInstallProgress) => {
        WindowManager.sendToAppWindows("on-proton-install-progress", payload);
      },
      minIntervalMs: PROTON_INSTALL_MIN_PROGRESS_INTERVAL_MS,
    });

    try {
      if (!provider) throw new Error("proton_unknown_provider");

      const release = await this.catalog.findReleaseByTag(provider, job.tag);
      if (!release) throw new Error("proton_release_not_found");

      const { targetDir } = resolveInstallTarget(await this.getTargetsInput());
      await fs.promises.mkdir(targetDir, { recursive: true });

      const workspaceDir = path.join(
        SystemPath.getPath("userData"),
        "ProtonDownloads",
        job.tag
      );

      await runProtonInstallJob({
        providerId: job.providerId,
        release,
        targetDir,
        workspaceDir,
        deps: REAL_INSTALL_JOB_DEPS,
        signal: job.controller.signal,
        onProgress: sendProgress,
      });

      logger.info("Proton install job completed", {
        providerId: job.providerId,
        tag: job.tag,
        targetDir,
      });
    } catch (error) {
      const errorCode = toProtonErrorCode(error);

      logger.error("Proton install job failed", {
        providerId: job.providerId,
        tag: job.tag,
        errorCode,
        error,
      });

      sendProgress({
        providerId: job.providerId,
        tag: job.tag,
        phase: "error",
        error: errorCode,
      });
    } finally {
      if (this.activeJob === job) {
        this.activeJob = null;
      }
    }
  }

  public static cancelInstall(providerId: string, tag: string): boolean {
    const job = this.activeJob;
    if (!job) return false;
    if (job.providerId !== providerId || job.tag !== tag) return false;

    logger.info("Canceling Proton install job", { providerId, tag });
    job.controller.abort();
    return true;
  }

  /**
   * Removes an installed Proton build. The path must live strictly
   * inside a known compatibility tool root and be a valid Proton
   * directory before anything is deleted.
   */
  public static async removeInstalled(
    protonPath: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (process.platform !== "linux") {
      return { ok: false, error: "proton_linux_only" };
    }

    const roots = getCompatToolRoots(await this.getTargetsInput());
    const validation = validateProtonRemoval(
      protonPath,
      roots,
      isValidProtonDirectory
    );
    if (!validation.ok) {
      logger.warn("Refusing to remove Proton directory", {
        protonPath,
        reason: validation.error,
      });
      return { ok: false, error: validation.error };
    }

    try {
      await fs.promises.rm(protonPath, { recursive: true });
      logger.info("Removed installed Proton build", { protonPath });
      return { ok: true };
    } catch (error) {
      logger.error("Failed to remove installed Proton build", {
        protonPath,
        error,
      });
      return { ok: false, error: "proton_remove_failed" };
    }
  }
}
