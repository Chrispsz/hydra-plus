import { registerEvent } from "../register-event";
import { gamesSublevel, downloadsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { lookupCachedPlatform } from "./get-library";

const getGameByObjectId = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const [game, download] = await Promise.all([
    gamesSublevel.get(gameKey),
    downloadsSublevel.get(gameKey),
  ]);

  if (!game || game.isDeleted) return null;

  if (game.shop === "launchbox" && !game.platform) {
    const cachedPlatform = await lookupCachedPlatform(gameKey);
    if (cachedPlatform) {
      game.platform = cachedPlatform;
      gamesSublevel.put(gameKey, game).catch(() => {});
    }
  }

  return {
    ...game,
    id: gameKey,
    download,
  };
};

registerEvent("getGameByObjectId", getGameByObjectId);
