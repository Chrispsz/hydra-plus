import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import axios from "axios";
import { app } from "electron";

import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";

/**
 * Smart self-update for the Windows portable exe.
 *
 * electron-updater cannot replace a portable executable (it has no
 * installer to hand over to), so Windows portable users were previously
 * sent to the releases page in a browser. This implements the same
 * in-place update the AppImage gets:
 *
 *   1. download the new portable exe from the fork's GitHub releases
 *   2. write a tiny batch script that waits for this process to exit,
 *      replaces the running exe AT THE SAME PATH (same folder, same
 *      shortcuts — no leftovers, the old exe is gone)
 *   3. relaunch it and quit
 *
 * Settings, logins and library data live in %APPDATA% (userData), which is
 * never touched by an update.
 */

const UPDATE_TEMP_DIR = "hydra-plus-update";
const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/Chrispsz/hydra-plus/releases/latest";

export interface PortableReleaseInfo {
  version: string;
  downloadUrl: string;
  sizeBytes: number;
}

let cachedRelease: PortableReleaseInfo | null = null;
let downloadedUpdatePath: string | null = null;
let downloadedVersion: string | null = null;

const getUpdateTempRoot = () =>
  path.join(SystemPath.getPath("temp"), UPDATE_TEMP_DIR);

export const isPortableWindowsBuild = () =>
  process.platform === "win32" && Boolean(process.env.PORTABLE_EXECUTABLE_FILE);

export const getPortableExecutablePath = (): string | null =>
  process.env.PORTABLE_EXECUTABLE_FILE ?? null;

/** Resolves the newest fork release that ships a portable exe asset. */
export const fetchLatestPortableRelease =
  async (): Promise<PortableReleaseInfo | null> => {
    if (!isPortableWindowsBuild()) return null;

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
        headers: { Accept: "application/vnd.github+json" },
      });

      const version = (data.tag_name ?? "").replace(/^v/, "");
      const asset = (data.assets ?? []).find(
        (candidate) =>
          typeof candidate.browser_download_url === "string" &&
          candidate.name?.endsWith("-portable.exe")
      );
      if (!version || !asset?.browser_download_url) return null;

      cachedRelease = {
        version,
        downloadUrl: asset.browser_download_url,
        sizeBytes: asset.size ?? 0,
      };
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

export const downloadPortableUpdate = async (
  onProgress?: (percent: number) => void
): Promise<string> => {
  if (!cachedRelease) {
    throw new Error("portable_update_release_unresolved");
  }

  const targetPath = path.join(
    getUpdateTempRoot(),
    `hydra-plus-${cachedRelease.version}-portable.exe`
  );
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

  const { data } = await axios.get<NodeJS.ReadableStream>(
    cachedRelease.downloadUrl,
    { responseType: "stream", timeout: 0 }
  );

  await new Promise<void>((resolve, reject) => {
    const writer = fs.createWriteStream(targetPath);
    let received = 0;
    const total = cachedRelease?.sizeBytes || 0;

    data.on("data", (chunk: Buffer) => {
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

  downloadedUpdatePath = targetPath;
  downloadedVersion = cachedRelease.version;
  logger.log(`Portable update downloaded to ${targetPath}`);
  return targetPath;
};

/**
 * Writes and spawns the replacement batch script, then quits the app.
 * The batch loop waits for the current PID to disappear, moves the new exe
 * over the old one (same path — shortcuts keep working), relaunches and
 * removes itself.
 */
export const applyPortableUpdate = async (): Promise<void> => {
  const targetExe = getPortableExecutablePath();
  if (!targetExe) throw new Error("portable_executable_path_unresolved");
  if (!downloadedUpdatePath || !fs.existsSync(downloadedUpdatePath)) {
    throw new Error("portable_update_not_downloaded");
  }

  const scriptPath = path.join(getUpdateTempRoot(), "hydra-plus-update.cmd");
  const pid = process.pid;
  const script = [
    "@echo off",
    "setlocal",
    ":waitloop",
    `tasklist /FI "PID eq ${pid}" | find /I "${path.basename(targetExe)}" >nul`,
    "if not errorlevel 1 (",
    "  timeout /t 1 /nobreak >nul",
    "  goto waitloop",
    ")",
    `move /y "${targetExe}" "${targetExe}.new" >nul`,
    `move /y "${targetExe}" "${targetExe}.old.bak" >nul`,
    `move /y "${targetExe}.new" "${targetExe}" >nul`,
    `if exist "${targetExe}.old.bak" del /f /q "${targetExe}.old.bak" >nul`,
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
