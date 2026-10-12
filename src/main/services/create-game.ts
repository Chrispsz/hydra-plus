import type { Game } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";

/**
 * Persists a game in the local library. Hydra Plus has no remote profile:
 * the record is written to LevelDB only.
 */
export const createGame = async (game: Game) => {
  if (game.shop === "custom") {
    return;
  }

  return gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
    ...game,
    addedToLibraryAt: game.addedToLibraryAt ?? new Date(),
  });
};
