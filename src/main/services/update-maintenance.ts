import { app, session } from "electron";
import fs from "node:fs";
import path from "node:path";

import { logsPath } from "@main/constants";
import { db, levelKeys } from "@main/level";
import { logger } from "./logger";
import { cleanupPortableUpdateCache } from "./portable-updater";

const LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Regenerable Electron cache directories inside userData. Removing them is
 * always safe — Electron recreates them on demand — and keeps the install
 * lean the way a clean install would, without touching any user data.
 */
const REGENERABLE_CACHE_DIRS = [
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "DawnCache",
  "ShaderCache",
];

const directorySize = async (dir: string): Promise<number> => {
  let total = 0;

  const walk = async (current: string): Promise<void> => {
    const entries = await fs.promises
      .readdir(current, { withFileTypes: true })
      .catch(() => []);

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      const stat = await fs.promises.stat(entryPath).catch(() => undefined);
      total += stat?.size ?? 0;
    }
  };

  await walk(dir);
  return total;
};

const deleteDirectoryWithSize = async (dir: string): Promise<number> => {
  const exists = await fs.promises
    .stat(dir)
    .then(() => true)
    .catch(() => false);

  if (!exists) return 0;

  const size = await directorySize(dir);
  await fs.promises.rm(dir, { recursive: true, force: true });
  return size;
};

const pruneOldLogs = async (): Promise<number> => {
  let freedBytes = 0;

  const entries = await fs.promises
    .readdir(logsPath)
    .catch(() => [] as string[]);

  const cutoff = Date.now() - LOG_RETENTION_MS;

  for (const entry of entries) {
    const entryPath = path.join(logsPath, entry);
    const stat = await fs.promises.stat(entryPath).catch(() => undefined);

    if (!stat || stat.isDirectory()) continue;
    if (stat.mtimeMs >= cutoff) continue;

    freedBytes += stat.size;
    await fs.promises.rm(entryPath, { force: true }).catch(() => undefined);
  }

  return freedBytes;
};

/**
 * Runs once per new app version: purges every regenerable cache (HTTP cache,
 * GPU/Code caches, staged-update leftovers, stale logs) and compacts the
 * on-disk database. Each update therefore starts from a clean runtime —
 * "almost like a clean install" — while library, preferences, saves and all
 * other user data stay untouched.
 */
export const runPostUpdateMaintenance = async (): Promise<void> => {
  const currentVersion = app.getVersion();

  const previousVersion = await db
    .get<string, string | null>(levelKeys.lastVersionSeen, {
      valueEncoding: "utf8",
    })
    .catch(() => null);

  if (previousVersion === currentVersion) return;

  logger.info(
    `Post-update maintenance: ${previousVersion ?? "fresh install"} -> ${currentVersion}`
  );

  let freedBytes = 0;

  try {
    await session.defaultSession.clearCache();
  } catch (error) {
    logger.warn("Failed to clear HTTP cache", error);
  }

  const userData = app.getPath("userData");
  for (const dir of REGENERABLE_CACHE_DIRS) {
    freedBytes += await deleteDirectoryWithSize(path.join(userData, dir)).catch(
      () => 0
    );
  }

  await cleanupPortableUpdateCache();
  freedBytes += await pruneOldLogs().catch(() => 0);

  try {
    await db.compactRange("\u0000", "\uffff");
  } catch (error) {
    logger.warn("Failed to compact database", error);
  }

  await db.put<string, string>(levelKeys.lastVersionSeen, currentVersion, {
    valueEncoding: "utf8",
  });

  logger.info(
    `Post-update maintenance done (${(freedBytes / 1024 / 1024).toFixed(2)} MB of caches freed)`
  );
};
