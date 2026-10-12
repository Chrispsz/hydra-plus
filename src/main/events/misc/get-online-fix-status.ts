import path from "node:path";

import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { parseExecutablePath } from "../helpers/parse-executable-path";
import {
  detectSteamInstallKind,
  findOnlineFixMarkers,
  isSteamClientRunning,
  readLastWineModuleError,
} from "@main/services/online-fix";
import type { GameShop } from "@types";

/**
 * Live diagnostics for the Online-Fix session of a game: whether the
 * Steam client is running, whether the patch DLLs are still present in
 * the game folder (an antivirus quarantine makes them disappear and is
 * the classic cause of the "failed to load steam overlay dll, error
 * 126" message), how Steam is installed (Flatpak/Snap setups are the
 * recurring "126 with Steam installed" report) and the last Wine module
 * error logged (names the exact missing dependency on Linux).
 */
registerEvent(
  "getOnlineFixStatus",
  async (_event, shop: GameShop, objectId: string) => {
    const steamRunning = await isSteamClientRunning();

    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);

    if (!game?.executablePath) {
      return {
        steamRunning,
        onlineFixDetected: null,
        steamInstallKind: detectSteamInstallKind(),
        lastLaunchError: readLastWineModuleError(),
      };
    }

    try {
      const executablePath = parseExecutablePath(game.executablePath);
      const markers = findOnlineFixMarkers(path.dirname(executablePath));
      return {
        steamRunning,
        onlineFixDetected: markers.length > 0,
        steamInstallKind: detectSteamInstallKind(),
        lastLaunchError: readLastWineModuleError(),
      };
    } catch {
      return {
        steamRunning,
        onlineFixDetected: null,
        steamInstallKind: detectSteamInstallKind(),
        lastLaunchError: readLastWineModuleError(),
      };
    }
  }
);
