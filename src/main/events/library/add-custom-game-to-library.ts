import { randomUUID } from "node:crypto";
import fs from "node:fs";

import { registerEvent } from "../register-event";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import {
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  getCloudSaveGameContext,
  registerCloudSaveCustomPaths,
} from "@main/services/cloud-save";
import { registerSavePathsForCustomGame } from "@main/services/external-games/custom-game-save-paths";
import { logger } from "@main/services/logger";
import type { GameShop } from "@types";

const addCustomGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  title: string,
  executablePath: string,
  iconUrl?: string,
  logoImageUrl?: string,
  libraryHeroImageUrl?: string,
  savePaths?: string[],
  platform?: string,
  source?: string
) => {
  const objectId = randomUUID();
  const shop: GameShop = "custom";
  const gameKey = levelKeys.game(shop, objectId);

  const existingGames = await gamesSublevel.iterator().all();
  const existingGame = existingGames.find(
    ([_key, game]) => game.executablePath === executablePath && !game.isDeleted
  );

  if (existingGame) {
    throw new Error(
      "A game with this executable path already exists in your library"
    );
  }

  const assets = {
    updatedAt: Date.now(),
    objectId,
    shop,
    title,
    iconUrl: iconUrl || null,
    libraryHeroImageUrl: libraryHeroImageUrl || "",
    libraryImageUrl: iconUrl || "",
    logoImageUrl: logoImageUrl || "",
    logoPosition: null,
    coverImageUrl: iconUrl || "",
    downloadSources: [],
  };
  await gamesShopAssetsSublevel.put(gameKey, assets);

  // Freshly imported external games can carry their save-path matrix
  // (Hytale: UserData/Saves + Settings.json) so Cloud Save V2 tracks them
  // without a manual folder pick. The executable platform decides how the
  // launch pipeline treats the game (Windows compatibility or native).
  const resolvedPlatform =
    platform ??
    (executablePath.toLowerCase().endsWith(".exe") ? "windows" : "linux");

  const game = {
    title,
    iconUrl: iconUrl || null,
    logoImageUrl: logoImageUrl || null,
    libraryHeroImageUrl: libraryHeroImageUrl || null,
    objectId,
    shop,
    remoteId: null,
    isDeleted: false,
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    addedToLibraryAt: new Date(),
    executablePath,
    executablePathUpdatedAt: new Date(),
    launchOptions: null,
    favorite: false,
    automaticCloudSync: false,
    hasManuallyUpdatedPlaytime: false,
    platform: resolvedPlatform,
  };

  await gamesSublevel.put(gameKey, game);

  if (savePaths && savePaths.length > 0) {
    if (source) {
      logger.info("[addCustomGameToLibrary] Registering external game saves", {
        objectId,
        source,
        savePathCount: savePaths.length,
      });
    }

    // Mirrors select-cloud-save-custom-path: canonicalize against the game
    // context, register through the custom-path store (which owns the user
    // id key), pending until the first sync pushes them to Drive.
    await registerSavePathsForCustomGame(shop, objectId, savePaths, {
      getCustomPathContext: async (objectId, shop) =>
        cloudSaveCustomPathContextFromPathContext(
          (await getCloudSaveGameContext(objectId, shop)).pathContext
        ),
      statPath: async (savePath) => {
        try {
          const stats = await fs.promises.stat(savePath);
          return stats.isDirectory() ? "dir" : stats.isFile() ? "file" : null;
        } catch {
          return null;
        }
      },
      canonicalize: canonicalizeSelectedCloudSaveCustomPath,
      registerCloudSaveCustomPaths,
      warn: (message, ...meta) => logger.warn(message, ...meta),
    }).catch((error: unknown) => {
      logger.error("[Cloud Save] Failed to register custom game save paths", {
        objectId,
        shop,
        error,
      });
    });
  }

  return game;
};

registerEvent("addCustomGameToLibrary", addCustomGameToLibrary);
