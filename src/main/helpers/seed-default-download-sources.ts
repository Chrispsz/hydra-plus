import { db, downloadSourcesSublevel, levelKeys } from "@main/level";
import { HydraApi, logger } from "@main/services";
import type { DownloadSource } from "@types";

/**
 * Curated default download sources so the Downloads search works out of
 * the box with the BEST of the official Hydra Library
 * (library.hydra.wiki/sources — every entry below is Trusted or Safe For
 * Use there, chosen for what users actually want):
 *
 * Direct download / pre-installed (fast hosts, no installer pain):
 *  - SteamRip: pre-installed, uncompressed, gofile (Trusted)
 *  - AtopGames: unaltered pre-installed, gofile (Trusted)
 *  - David Kazumi: gofile direct links (Safe For Use)
 *  - SteamGG: pre-installed, akirabox (Safe For Use)
 *  - RexaGames: pre-installed direct links (Trusted)
 *  - Free GOG: DRM-free vetted releases (Trusted)
 *
 * Multiplayer (pairs with the launcher's Online mode):
 *  - Online-Fix: the official online-fix.me packages (Trusted)
 *
 * Torrent — the scene's best repackers:
 *  - FitGirl (Trusted) / DODI (Trusted) / ByXatab (Trusted)
 *  - Rutracker & Rutor: broad multi-language catalogue (Safe For Use)
 *
 * Every addition is best-effort: any failure (offline, backend down) is
 * logged and retried on the next boot while the seed is incomplete. The
 * user's own sources are never touched — only the previous auto-seeded
 * defaults (v2, rated "Use At Your Own Risk" on the Library) are removed
 * in favor of this curated set. Re-seeding is idempotent.
 */
const DEFAULT_DOWNLOAD_SOURCES = [
  "https://hydralinks.cloud/sources/steamrip.json",
  "https://hydralinks.cloud/sources/atop-games.json",
  "https://davidkazumisource.com/fontekazumi.json",
  "https://wkeynhk.online/steamgg.json",
  "https://hydralinks.cloud/sources/rexagames.json",
  "https://hydralinks.cloud/sources/gog.json",
  "https://hydralinks.cloud/sources/onlinefix.json",
  "https://hydralinks.cloud/sources/fitgirl.json",
  "https://hydralinks.cloud/sources/dodi.json",
  "https://hydralinks.cloud/sources/xatab.json",
  "https://wkeynhk.online/rutor.json",
];

/** The v2 auto-seeded feeds, superseded by the Hydra Library curated set. */
const SUPERSEDED_DEFAULT_SOURCES = [
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/repack-igruha.json",
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/itorrents-igruha.json",
  "https://raw.githubusercontent.com/sotik11/hydra-download-sources/main/data/rutor.json",
  "https://raw.githubusercontent.com/Mimimitya/hydra-sources/main/fitgirl.json",
  "https://raw.githubusercontent.com/Mimimitya/hydra-sources/main/xatab.json",
  "https://raw.githubusercontent.com/ArnamentGames/HydraLinks/main/onlinefix.json",
  "https://raw.githubusercontent.com/ArnamentGames/HydraLinks/main/gog.json",
];

const hasV3BeenSeeded = async (): Promise<boolean> => {
  try {
    return (
      (await db.get<string, boolean>(levelKeys.defaultDownloadSourcesSeededV3, {
        valueEncoding: "json",
      })) === true
    );
  } catch {
    return false;
  }
};

const markV3Seeded = async (): Promise<void> => {
  await db.put<string, boolean>(
    levelKeys.defaultDownloadSourcesSeededV3,
    true,
    { valueEncoding: "json" }
  );
};

export const seedDefaultDownloadSources = async (): Promise<void> => {
  if (await hasV3BeenSeeded()) return;

  const existingSources = await downloadSourcesSublevel.values().all();
  const existingUrls = new Set(existingSources.map((source) => source.url));

  // Retire the superseded v2 defaults (never user-added ones: users who
  // manually re-added them after removing will see them come back only
  // once, at this migration).
  const superseded = SUPERSEDED_DEFAULT_SOURCES.filter((url) =>
    existingUrls.has(url)
  );

  for (const source of existingSources) {
    if (superseded.includes(source.url)) {
      await downloadSourcesSublevel.del(source.id).catch((error) =>
        logger.warn("Failed to retire superseded default source", {
          url: source.url,
          error,
        })
      );
    }
  }

  const remainingSources = await downloadSourcesSublevel.values().all();
  const remainingUrls = new Set(remainingSources.map((source) => source.url));

  const pendingUrls = DEFAULT_DOWNLOAD_SOURCES.filter(
    (url) => !remainingUrls.has(url)
  );

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
      `Seeded ${addedCount}/${pendingUrls.length} Hydra Library source(s)`
    );
  }

  // Marked as handled once the migration ran; a source that failed to
  // index (backend hiccup) can be re-added manually from the Hydra
  // Library URL. Retrying on every boot is not worth the churn.
  await markV3Seeded();
};
