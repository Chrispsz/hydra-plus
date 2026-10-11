import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import axios from "axios";
import { app } from "electron";

import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import { isNewerVersion, parseLatestYml } from "./portable-update-version";

/**
 * Smart self-update for the Windows portable exe.
 *
 * electron-updater cannot replace a portable executable (it has no
 * installer to hand over to), so the portable build updates through its
 * own pipeline — the same in-place update the AppImage gets:
 *
 *   1. read the latest GitHub release and only offer versions strictly
 *      newer than the running one
 *   2. download the new portable exe, verifying its sha512 against the
 *      latest.yml metadata published with the release
 *   3. write a tiny batch script that waits for this process to exit,
 *      swaps the new exe IN PLACE (same folder, same shortcuts — the old
 *      exe is removed, with a one-shot backup/restore on failure),
 *      relaunches the app and deletes itself
 *
 * Settings, logins and library data live in %APPDATA% (userData), which is
 * never touched by an update.
 */

const UPDATE_TEMP_DIR = "hydra-plus-update";
const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/Chrispsz/hydra-plus/releases/latest";

const GITHUB_HEADERS = { Accept: "application/vnd.github+json" };
const MOVE_RETRY_LIMIT = 15;

export interface PortableReleaseInfo {
  version: string;
  downloadUrl: string;
  sizeBytes: number;
}

interface ResolvedPortableRelease extends PortableReleaseInfo {
  /** sha512 (base64) from latest.yml — undefined when unverifiable. */
  sha512?: string;
}

let cachedRelease: ResolvedPortableRelease | null = null;
let downloadedUpdatePath: string | null = null;
let downloadedVersion: string | null = null;

const getUpdateTempRoot = () =>
  path.join(SystemPath.getPath("temp"), UPDATE_TEMP_DIR);

export const isPortableWindowsBuild = () =>
  process.platform === "win32" && Boolean(process.env.PORTABLE_EXECUTABLE_FILE);

export const getPortableExecutablePath = (): string | null =>
  process.env.PORTABLE_EXECUTABLE_FILE ?? null;

/** Downloads and parses the latest.yml metadata for integrity checking. */
const fetchLatestYmlSha512 = async (
  assetName: string,
  assets: Array<{ name?: string; browser_download_url?: string }>
): Promise<string | undefined> => {
  const ymlAsset = assets.find((asset) => asset.name === "latest.yml");
  if (!ymlAsset?.browser_download_url) return undefined;

  try {
    const { data } = await axios.get<string>(ymlAsset.browser_download_url, {
      timeout: 15_000,
      headers: GITHUB_HEADERS,
    });

    const { path: ymlPath, sha512 } = parseLatestYml(data);

    // The hash only applies to the artifact the yml points at.
    if (sha512 && (!ymlPath || ymlPath === assetName)) return sha512;

    logger.warn("latest.yml does not match the portable asset; skipping hash");
    return undefined;
  } catch (error) {
    logger.warn("Failed to read latest.yml for the portable update", error);
    return undefined;
  }
};

/** Resolves the newest fork release that ships a portable exe asset. */
export const fetchLatestPortableRelease =
  async (): Promise<PortableReleaseInfo | null> => {
    if (!isPortableWindowsBuild()) return null;

    downloadedUpdatePath = null;
    downloadedVersion = null;

    try {
      const { data } = await axios.get<{
        tag_name?: string;
        assets?: Array<{
          name?: string;
          browser_download_url?: string;
          size?: number;
        }>;
      }>(GITHUB_LATEST_RELEASE_URL, {
        timeout: 15_000,
        headers: GITHUB_HEADERS,
      });

      const version = (data.tag_name ?? "").replace(/^v/, "");
      const asset = (data.assets ?? []).find(
        (candidate) =>
          typeof candidate.browser_download_url === "string" &&
          candidate.name?.endsWith("-portable.exe")
      );
      if (!version || !asset?.browser_download_url || !asset.name) return null;

      // Never offer the release the user is already running.
      if (!isNewerVersion(version, app.getVersion())) return null;

      const sha512 = await fetchLatestYmlSha512(asset.name, data.assets ?? []);

      cachedRelease = {
        version,
        downloadUrl: asset.browser_download_url,
        sizeBytes: asset.size ?? 0,
        ...(sha512 ? { sha512 } : {}),
      };

      // The banner may re-mount mid-session: keep the "downloaded" state
      // when the file for this exact version is already staged in temp.
      const stagedPath = path.join(
        getUpdateTempRoot(),
        `hydra-plus-${version}-portable.exe`
      );
      if (fs.existsSync(stagedPath)) {
        downloadedUpdatePath = stagedPath;
        downloadedVersion = version;
      }

      return cachedRelease;
    } catch (error) {
      logger.warn("Failed to fetch latest portable release", error);
      return null;
    }
  };

export const getPortableUpdateState = () => ({
  release: cachedRelease,
  downloaded: Boolean(downloadedUpdatePath),
  downloadedVersion,
});

/** Streams a file to disk while computing its sha512 (base64). */
const downloadWithHash = async (
  url: string,
  targetPath: string,
  onProgress?: (percent: number) => void
): Promise<string> => {
  const { data } = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: "stream",
    timeout: 0,
  });

  const hash = crypto.createHash("sha512");
  let received = 0;
  const total = cachedRelease?.sizeBytes || 0;

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(targetPath);

    data.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      if (total > 0) {
        onProgress?.(Math.min(100, Math.round((received / total) * 100)));
      }
    });
    data.on("error", reject);
    writer.on("error", reject);
    writer.on("finish", () => resolve());
    data.pipe(writer);
  });

  return hash.digest("base64");
};

export const downloadPortableUpdate = async (
  onProgress?: (percent: number) => void
): Promise<string> => {
  if (!cachedRelease) {
    throw new Error("portable_update_release_unresolved");
  }

  const { sha512, sizeBytes, version, downloadUrl } = cachedRelease;

  const targetPath = path.join(
    getUpdateTempRoot(),
    `hydra-plus-${version}-portable.exe`
  );
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

  let actualSha512: string;
  try {
    actualSha512 = await downloadWithHash(downloadUrl, targetPath, onProgress);
  } catch (error) {
    await fs.promises.rm(targetPath, { force: true }).catch(() => undefined);
    throw error;
  }

  if (sha512 && actualSha512 !== sha512) {
    await fs.promises.rm(targetPath, { force: true }).catch(() => undefined);
    logger.error("Portable update download failed the sha512 check");
    throw new Error("portable_update_corrupted");
  }

  if (sizeBytes > 0) {
    const { size } = await fs.promises.stat(targetPath);
    if (size !== sizeBytes) {
      await fs.promises.rm(targetPath, { force: true }).catch(() => undefined);
      logger.error("Portable update download size mismatch");
      throw new Error("portable_update_corrupted");
    }
  }

  downloadedUpdatePath = targetPath;
  downloadedVersion = version;
  logger.log(`Portable update downloaded to ${targetPath}`);
  return targetPath;
};

/**
 * Writes and spawns the replacement batch script, then quits the app.
 * The script waits for the current PID to disappear, backs the running exe
 * up, moves the DOWNLOADED exe over the original path (same path —
 * shortcuts keep working), relaunches and removes itself. If the swap
 * keeps failing, the backup is restored so the app still opens.
 */
export const applyPortableUpdate = async (): Promise<void> => {
  const targetExe = getPortableExecutablePath();
  if (!targetExe) throw new Error("portable_executable_path_unresolved");
  if (!downloadedUpdatePath || !fs.existsSync(downloadedUpdatePath)) {
    throw new Error("portable_update_not_downloaded");
  }

  const scriptPath = path.join(getUpdateTempRoot(), "hydra-plus-update.cmd");
  const pid = process.pid;
  const exeName = path.basename(targetExe);
  const backupPath = `${targetExe}.old.bak`;
  const script = [
    "@echo off",
    "setlocal",
    ":waitloop",
    `tasklist /FI "PID eq ${pid}" | find /I "${exeName}" >nul`,
    "if not errorlevel 1 (",
    "  timeout /t 1 /nobreak >nul",
    "  goto waitloop",
    ")",
    `move /y "${targetExe}" "${backupPath}" >nul`,
    "set RETRIES=0",
    ":replaceloop",
    `move /y "${downloadedUpdatePath}" "${targetExe}" >nul 2>&1`,
    "if not errorlevel 1 goto replaceok",
    `if %RETRIES% GEQ ${MOVE_RETRY_LIMIT} goto replacefail`,
    "set /a RETRIES=%RETRIES%+1",
    "timeout /t 1 /nobreak >nul",
    "goto replaceloop",
    ":replaceok",
    `if exist "${backupPath}" del /f /q "${backupPath}" >nul`,
    `start "" "${targetExe}"`,
    `del /f /q "${scriptPath}" >nul`,
    "endlocal",
    "exit /b",
    ":replacefail",
    `move /y "${backupPath}" "${targetExe}" >nul`,
    `start "" "${targetExe}"`,
    `del /f /q "${scriptPath}" >nul`,
    "endlocal",
  ].join("\r\n");

  await fs.promises.writeFile(scriptPath, script, "utf8");
  const child = spawn("cmd.exe", ["/c", scriptPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  logger.log(`Portable update staged via ${scriptPath}; quitting app`);
  app.quit();
};

/** Removes stale staged updates from previous sessions. */
export const cleanupPortableUpdateCache = async (): Promise<void> => {
  const root = getUpdateTempRoot();
  try {
    await fs.promises.rm(root, { recursive: true, force: true });
  } catch (error) {
    logger.warn("Failed to clean portable update cache", error);
  }
};
