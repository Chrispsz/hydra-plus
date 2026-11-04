import path from "node:path";
import type { GameShop, UserPreferences } from "@types";
import { Umu } from "@main/services";
import { getNewestInstalledCachyOsProtonPath } from "@main/services/proton/default-proton";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";

const getGameLaunchProtonVersion = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  if (process.platform !== "linux") {
    return null;
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey).catch(() => null);
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const gameProtonPath = game?.protonPath;
  if (gameProtonPath && Umu.isValidProtonPath(gameProtonPath)) {
    return path.basename(gameProtonPath);
  }

  const defaultProtonPath = userPreferences?.defaultProtonPath;
  if (defaultProtonPath && Umu.isValidProtonPath(defaultProtonPath)) {
    return path.basename(defaultProtonPath);
  }

  // Read-only view of the launch fallback: the newest installed CachyOS
  // build (the launch itself may auto-install it when none exists —
  // never triggered from here).
  const fallbackProtonPath = await getNewestInstalledCachyOsProtonPath();
  return fallbackProtonPath ? path.basename(fallbackProtonPath) : null;
};

registerEvent("getGameLaunchProtonVersion", getGameLaunchProtonVersion);
