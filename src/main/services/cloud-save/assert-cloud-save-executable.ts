import { access } from "node:fs/promises";
import { isCloudSaveV2Eligible } from "@shared";

import { gamesSublevel, levelKeys } from "@main/level";

import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { createCloudSaveExecutableGuard } from "./executable-path-guard";

export const assertCloudSaveExecutableExists = createCloudSaveExecutableGuard({
  getGame: (objectId, shop) =>
    gamesSublevel.get(levelKeys.game(shop, objectId)),
  saveGame: (game) =>
    gamesSublevel.put(levelKeys.game(game.shop, game.objectId), game),
  pathExists: (executablePath) =>
    access(executablePath).then(
      () => true,
      () => false
    ),
  onExecutablePathCleared: (game, executablePath) => {
    logger.warn(
      "[Cloud Save] Sync cancelled because executable no longer exists",
      {
        shop: game.shop,
        objectId: game.objectId,
        executablePath,
      }
    );
    WindowManager.sendToAppWindows("on-library-batch-complete");
  },
});

export const assertCloudSaveV2Eligible = async (
  objectId: string,
  shop: Parameters<typeof assertCloudSaveExecutableExists>[1]
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!game || !isCloudSaveV2Eligible(shop, game.platform)) {
    throw new Error("cloud_save_v2_not_available");
  }
  return game;
};

export const assertCloudSaveRuntimeAvailable = async (
  objectId: string,
  shop: Parameters<typeof assertCloudSaveExecutableExists>[1]
) => {
  const game = await assertCloudSaveV2Eligible(objectId, shop);
  return assertCloudSaveExecutableExists(objectId, shop).then(() => game);
};
