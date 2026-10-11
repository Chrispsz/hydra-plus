import { db, downloadSourcesSublevel, levelKeys } from "@main/level";
import { HydraApi, logger } from "@main/services";
import type { DownloadSource } from "@types";

/**
 * Curated default download sources, added on the very first run so the
 * Downloads search works out of the box (fresh installs start with zero
 * sources). Community-maintained Hydra-format feeds that are regenerated
 * continuously:
 *
 *  - Torrent Igruha / Repack Igruha: magnets with fast udp trackers
 *  - Rutor: broad multi-language catalogue
 *
 * Every addition is best-effort: any failure (offline, backend down) is
 * logged and retried on the next boot while nothing was seeded yet. The
 * user's own sources are never touched.
 */
const DEFAULT_DOWNLOAD_SOURCES = [
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/repack-igruha.json",
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/itorrents-igruha.json",
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/rutor.json",
];

const hasDefaultSourcesBeenSeeded = async (): Promise<boolean> => {
  try {
    return (
      (await db.get<string, boolean>(levelKeys.defaultDownloadSourcesSeeded, {
        valueEncoding: "json",
      })) === true
    );
  } catch {
    return false;
  }
};

export const seedDefaultDownloadSources = async (): Promise<void> => {
  if (await hasDefaultSourcesBeenSeeded()) return;

  const existingSources = await downloadSourcesSublevel.values().all();
  if (existingSources.length > 0) {
    // The user already manages their own sources — just mark as seeded so
    // we never touch them.
    await db.put<string, boolean>(
      levelKeys.defaultDownloadSourcesSeeded,
      true,
      { valueEncoding: "json" }
    );
    return;
  }

  let seededCount = 0;

  for (const url of DEFAULT_DOWNLOAD_SOURCES) {
    try {
      const downloadSource = await HydraApi.post<DownloadSource>(
        "/download-sources",
        { url },
        { needsAuth: false }
      );

      await downloadSourcesSublevel.put(downloadSource.id, {
        ...downloadSource,
        isRemote: true,
        createdAt: new Date().toISOString(),
      });

      seededCount += 1;
    } catch (error) {
      logger.warn("Failed to seed default download source", { url, error });
    }
  }

  if (seededCount > 0) {
    logger.log(`Seeded ${seededCount} default download source(s) on first run`);
  }

  // Flag as handled once at least one source landed; otherwise retry on
  // the next boot (the app may have been offline).
  if (seededCount > 0) {
    await db.put<string, boolean>(
      levelKeys.defaultDownloadSourcesSeeded,
      true,
      { valueEncoding: "json" }
    );
  }
};
