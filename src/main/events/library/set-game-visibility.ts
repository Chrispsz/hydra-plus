import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import type { GameShop } from "@types";

/**
 * Local-only conceal/hide toggle. There is no profile to hide games from:
 * "isConcealed" moves the game into the local Hidden section of the library.
 */
const setGameVisibility = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  isConcealed: boolean
) => {
  try {
    const gameKey = levelKeys.game(shop, objectId);

    const game = await gamesSublevel.get(gameKey);
    if (!game) return { isConcealed };

    await gamesSublevel.put(gameKey, {
      ...game,
      isConcealed,
    });

    return { isConcealed };
  } catch (error) {
    logger.error("Failed to update game visibility", error);
    throw new Error(`Failed to update game visibility: ${error}`);
  }
};

registerEvent("setGameVisibility", setGameVisibility);
