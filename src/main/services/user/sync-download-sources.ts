import { HydraApi, logger } from "../";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";

/**
 * Brings the signed-in user's profile download sources over (the
 * "catálogo sincronizado" the Hydra login provides): sources that exist
 * on the account but not locally are inserted, user sources are never
 * removed or overwritten. Subscription-gated upstream — without one the
 * endpoint 403s and we log once and move on.
 */
export const syncDownloadSourcesFromApi = async (): Promise<void> => {
  if (!HydraApi.isLoggedIn()) return;

  try {
    const profileSources = await HydraApi.get<DownloadSource[]>(
      "/profile/download-sources",
      null,
      { needsAuth: true }
    );

    const existingSources = await downloadSourcesSublevel.values().all();
    const existingUrls = new Set(existingSources.map((source) => source.url));

    let addedCount = 0;

    for (const downloadSource of profileSources) {
      if (existingUrls.has(downloadSource.url)) continue;

      try {
        await downloadSourcesSublevel.put(downloadSource.id, {
          ...downloadSource,
          isRemote: true,
          createdAt: new Date().toISOString(),
        });

        addedCount += 1;
        logger.log(
          `Synced download source from profile: ${downloadSource.url}`
        );
      } catch (error) {
        logger.error(
          `Failed to sync download source ${downloadSource.url}:`,
          error
        );
      }
    }

    if (addedCount > 0) {
      logger.log(`Synced ${addedCount} download source(s) from the profile`);
    }
  } catch (error) {
    logger.warn("Failed to sync download sources from the profile", error);
  }
};
