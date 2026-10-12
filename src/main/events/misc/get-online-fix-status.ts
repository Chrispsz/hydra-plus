import path from "node:path";

import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import {
  findOnlineFixMarkers,
  isSteamClientRunning,
} from "@main/services/online-fix";
import type { GameShop } from "@types";

/**
 * Live diagnostics for the Online-Fix session of a game: whether the
 * Steam client is running and whether the patch DLLs are still present
 * in the game folder (an antivirus quarantine makes them disappear and
 * is the classic cause of the "failed to load steam overlay dll,
 * error 126" message).
 */
registerEvent(
  "getOnlineFixStatus",
  async (_event, shop: GameShop, objectId: string) => {
    const steamRunning = await isSteamClientRunning();

    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);

    if (!game?.executablePath) {
      return { steamRunning, onlineFixDetected: null };
    }

    try {
      const executablePath = parseExecutablePath(game.executablePath);
      const markers = findOnlineFixMarkers(path.dirname(executablePath));
      return { steamRunning, onlineFixDetected: markers.length > 0 };
    } catch {
      return { steamRunning, onlineFixDetected: null };
    }
  }
);
