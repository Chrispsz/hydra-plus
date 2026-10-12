import { db, downloadSourcesSublevel, levelKeys } from "@main/level";
import { HydraApi, logger } from "@main/services";
import type { DownloadSource } from "@types";

/**
 * Curated default download sources so the Downloads search works out of
 * the box with a reliable, DIVERSE catalogue (v2 seeds them per-URL, so
 * existing installs receive the new feeds too). Community-maintained
 * Hydra-format feeds, validated for reachability + JSON shape:
 *
 *  - Torrent Igruha / Repack Igruha: magnets with fast udp trackers
 *  - Rutor: broad multi-language catalogue
 *  - FitGirl / Xatab (Mimimitya): the two most popular repack scenes,
 *    fresh and large feeds
 *  - Online-Fix catalogue (ArnamentGames/HydraLinks): the actual
 *    online-fix.me packages — pairs directly with the launcher's Online
 *    mode
 *  - GOG (ArnamentGames/HydraLinks): DRM-free magnets
 *
 * Every addition is best-effort: any failure (offline, backend down) is
 * logged and retried on the next boot while the seed is incomplete. The
 * user's own sources are never removed or overwritten — each URL is
 * checked before adding, so re-seeding is idempotent.
 */
const DEFAULT_DOWNLOAD_SOURCES = [
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/repack-igruha.json",
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/itorrents-igruha.json",
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/rutor.json",
  "https://raw.githubusercontent.com/Mimimitya/hydra-sources/main/fitgirl.json",
  "https://raw.githubusercontent.com/Mimimitya/hydra-sources/main/xatab.json",
  "https://raw.githubusercontent.com/ArnamentGames/HydraLinks/main/onlinefix.json",
  "https://raw.githubusercontent.com/ArnamentGames/HydraLinks/main/gog.json",
];

const hasDefaultSourcesBeenSeeded = async (): Promise<boolean> => {
  try {
    return (
      (await db.get<string, boolean>(levelKeys.defaultDownloadSourcesSeededV2, {
        valueEncoding: "json",
      })) === true
    );
  } catch {
    return false;
  }
};

const markDefaultSourcesSeeded = async (): Promise<void> => {
  await db.put<string, boolean>(
    levelKeys.defaultDownloadSourcesSeededV2,
    true,
    { valueEncoding: "json" }
  );
};

export const seedDefaultDownloadSources = async (): Promise<void> => {
  if (await hasDefaultSourcesBeenSeeded()) return;

  const existingSources = await downloadSourcesSublevel.values().all();
  const existingUrls = new Set(existingSources.map((source) => source.url));

  // Only URLs the user does not have yet — never remove or overwrite
  // anything, and re-running is a no-op once everything landed.
  const pendingUrls = DEFAULT_DOWNLOAD_SOURCES.filter(
    (url) => !existingUrls.has(url)
  );

  if (pendingUrls.length === 0) {
    await markDefaultSourcesSeeded();
    return;
  }

  let addedCount = 0;

  for (const url of pendingUrls) {
    try {
      const downloadSource = await HydraApi.post<DownloadSource>(
        "/download-sources",
        { url }
      );

      await downloadSourcesSublevel.put(downloadSource.id, {
        ...downloadSource,
        isRemote: true,
        createdAt: new Date().toISOString(),
      });

      addedCount += 1;
    } catch (error) {
      logger.warn("Failed to seed default download source", { url, error });
    }
  }

  if (addedCount > 0) {
    logger.log(
      `Seeded ${addedCount}/${pendingUrls.length} default download source(s)`
    );
    // Mark as handled once at least one landed; a feed that is
    // permanently unreachable should not retry on every boot. When
    // EVERYTHING failed (e.g. the app booted offline) the flag stays
    // unset and the next boot retries.
    await markDefaultSourcesSeeded();
  }
};
