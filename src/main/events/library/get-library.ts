import path from "node:path";
import fs from "node:fs";

import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";
import { belongsToLibraryCollection } from "@main/services";

const CACHED_PLATFORM_LANGUAGES = ["en", "pt-BR"];

export const lookupCachedPlatform = async (
  gameKey: string
): Promise<string | null> => {
  for (const language of CACHED_PLATFORM_LANGUAGES) {
    try {
      const value = await gamesShopCacheSublevel.get(`${gameKey}:${language}`);
      if (value?.platform) return value.platform;
    } catch {
      // Missing or unreadable language entry — try the next one.
    }
  }
  return null;
};

export const getLibrary = async (
  collection: "visible" | "hidden" | "all" = "visible"
): Promise<LibraryGame[]> => {
  return gamesSublevel
    .iterator()
    .all()
    .then((results) => {
      return Promise.all(
        results
          .filter(([_key, game]) =>
            belongsToLibraryCollection(game, collection)
          )
          .map(async ([key, game]) => {
            const download = await downloadsSublevel.get(key);
            const gameAssets = await gamesShopAssetsSublevel.get(key);
            const artworkSelection =
              await gamesArtworkSelectionSublevel.get(key);
            const composedAssets = composeAssetsWithArtwork(
              gameAssets ?? null,
              artworkSelection
            );

            // Verify installer still exists, clear if deleted externally
            let installerSizeInBytes = game.installerSizeInBytes;
            if (installerSizeInBytes && download?.folderName) {
              const installerPath = path.join(
                download.downloadPath,
                download.folderName
              );

              if (!fs.existsSync(installerPath)) {
                installerSizeInBytes = null;
                gamesSublevel
                  .put(key, { ...game, installerSizeInBytes: null })
                  .catch(() => {});
              }
            }

            if (
              game.shop === "launchbox" &&
              (!game.platform || game.platform === null)
            ) {
              const cachedPlatform = await lookupCachedPlatform(key);
              if (cachedPlatform) {
                game.platform = cachedPlatform;
                gamesSublevel.put(key, game).catch(() => {});
              }
            }

            // Verify installed folder still exists, clear if deleted externally
            let installedSizeInBytes = game.installedSizeInBytes;
            if (installedSizeInBytes && game.executablePath) {
              const executableDir = path.dirname(game.executablePath);

              if (!fs.existsSync(executableDir)) {
                installedSizeInBytes = null;
                gamesSublevel
                  .put(key, {
                    ...game,
                    installerSizeInBytes,
                    installedSizeInBytes: null,
                  })
                  .catch(() => {});
              }
            }

            return {
              id: key,
              ...game,
              installerSizeInBytes,
              installedSizeInBytes,
              download: download ?? null,
              // Spread composed assets last to ensure all image URLs are properly set
              ...composedAssets,
              title: composedAssets?.title || game.title,
              platform: game.platform ?? null,
              // Preserve custom image URLs from game if they exist
              customIconUrl: game.customIconUrl,
              customLogoImageUrl: game.customLogoImageUrl,
              customHeroImageUrl: game.customHeroImageUrl,
              customCoverImageUrl: game.customCoverImageUrl,
            };
          })
      );
    });
};

registerEvent("getLibrary", (_event, includeConcealed = false) =>
  getLibrary(includeConcealed ? "all" : "visible")
);
