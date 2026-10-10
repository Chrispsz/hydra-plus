import fs from "node:fs";
import path from "node:path";

import { gamesSublevel, levelKeys } from "@main/level";
import { getSteamLocation } from "@main/services/steam";
import { SystemPath } from "@main/services/system-path";
import { Wine } from "@main/services/wine";
import { logger } from "@main/services/logger";
import { getSteamStoreUserContext } from "@main/services/steam-login-users";
import { findSteamCompatibilityPrefixForApp } from "@main/services/steam-integration/steam-compat-prefix";
import type { CloudSavePathContext, Game, GameShop } from "@types";

import {
  CLOUD_SAVE_ENVIRONMENT_MARKER,
  resolveCloudSaveEnvironment,
  type CloudSavePrefixGenerationOverride,
} from "./cloud-save-environment";

export interface CloudSaveGameContextOverrides {
  executablePath?: string;
  winePrefixPath?: string | null;
  prefixGenerationOverride?: CloudSavePrefixGenerationOverride;
}

const getCloudSavePlatform = (): CloudSavePathContext["platform"] => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
};

const getRequestedWinePrefixPath = (
  usesWindowsCompatibility: boolean,
  gameWinePrefixPath: string | null | undefined,
  objectId: string,
  overrides?: CloudSaveGameContextOverrides
) => {
  if (!usesWindowsCompatibility) return null;
  if (overrides && "winePrefixPath" in overrides) {
    return overrides.winePrefixPath ?? null;
  }
  return Wine.getEffectivePrefixPath(gameWinePrefixPath, objectId);
};

const isValidWinePrefixPath = (winePrefixPath: string | null): boolean => {
  if (!winePrefixPath) return false;
  try {
    return Wine.validatePrefix(winePrefixPath);
  } catch {
    return false;
  }
};

/**
 * A prefix that cloud saves have already scanned carries the environment
 * marker. A launcher prefix WITHOUT it was never a real save environment
 * (typically a fresh prefix created by a failed umu launch attempt).
 */
const hasCloudSaveEnvironmentMarker = (prefixPath: string | null): boolean => {
  if (!prefixPath) return false;
  try {
    return fs.existsSync(path.join(prefixPath, CLOUD_SAVE_ENVIRONMENT_MARKER));
  } catch {
    return false;
  }
};

/**
 * Persists the adopted prefix on the game record so every consumer agrees
 * on ONE save environment: Cloud Save scanning/restoring AND the umu
 * launcher (WINEPREFIX) — the same prefix Steam sessions use.
 */
const persistAdoptedWinePrefix = async (
  game: Game | undefined,
  shop: GameShop,
  objectId: string,
  steamPrefixPath: string
): Promise<void> => {
  if (!game || game.winePrefixPath === steamPrefixPath) return;

  try {
    const gameKey = levelKeys.game(shop, objectId);
    await gamesSublevel.put(gameKey, {
      ...game,
      winePrefixPath: steamPrefixPath,
    });
    logger.info("[Cloud Save] Persisted Steam Proton prefix for game", {
      shop,
      objectId,
      steamPrefixPath,
    });
  } catch (error) {
    logger.warn(
      "[Cloud Save] Failed to persist adopted Steam Proton prefix",
      error
    );
  }
};

/**
 * Hydra Plus: on Linux, users often launch their games through Steam
 * instead of Hydra's own compatibility stack. Those sessions write saves
 * into Steam's Proton prefix (`<library>/compatdata/<appId>/pfx`).
 *
 * When the launcher prefix Hydra would use is missing/invalid — or valid
 * but was never an actual save environment (no cloud-save marker) — adopt
 * Steam's Proton prefix so Cloud Save V2 sees the saves those sessions
 * produce, and persist the choice so the umu launcher reuses it too.
 */
const resolveWinePrefixForCloudSave = async (
  game: Game | undefined,
  shop: GameShop,
  objectId: string,
  usesWindowsCompatibility: boolean,
  resolvedWinePrefixPath: string | null
): Promise<string | null> => {
  if (
    process.platform !== "linux" ||
    !usesWindowsCompatibility ||
    shop !== "steam"
  ) {
    return resolvedWinePrefixPath;
  }

  if (
    isValidWinePrefixPath(resolvedWinePrefixPath) &&
    hasCloudSaveEnvironmentMarker(resolvedWinePrefixPath)
  ) {
    return resolvedWinePrefixPath;
  }

  const steamPrefixPath = await findSteamCompatibilityPrefixForApp(
    objectId
  ).catch(() => null);

  if (!steamPrefixPath || steamPrefixPath === resolvedWinePrefixPath) {
    return resolvedWinePrefixPath;
  }

  logger.info(
    "[Cloud Save] Launcher prefix unavailable or unused; adopting Steam Proton prefix",
    {
      shop,
      objectId,
      launcherPrefixPath: resolvedWinePrefixPath,
      steamPrefixPath,
    }
  );
  await persistAdoptedWinePrefix(game, shop, objectId, steamPrefixPath);
  return steamPrefixPath;
};

export const getCloudSaveGameContext = async (
  objectId: string,
  shop: GameShop,
  overrides?: CloudSaveGameContextOverrides
) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const steamPath = await getSteamLocation().catch(() => undefined);
  const storeUserContext =
    shop === "steam" && steamPath
      ? await getSteamStoreUserContext(steamPath)
      : { known: [] };
  const platform = getCloudSavePlatform();
  const executablePath =
    overrides?.executablePath ?? game?.executablePath ?? undefined;
  const usesWindowsCompatibility =
    platform === "linux" &&
    executablePath?.toLowerCase().endsWith(".exe") === true;
  const requestedWinePrefixPath = getRequestedWinePrefixPath(
    usesWindowsCompatibility,
    game?.winePrefixPath,
    objectId,
    overrides
  );
  const winePrefixPath = await Wine.resolvePrefixPath(requestedWinePrefixPath);
  const effectiveWinePrefixPath = await resolveWinePrefixForCloudSave(
    game,
    shop,
    objectId,
    usesWindowsCompatibility,
    winePrefixPath
  );
  const pathContext: CloudSavePathContext = {
    shop,
    objectId,
    platform,
    homeDir: SystemPath.getPath("home"),
    documentsDir: SystemPath.getPath("documents") || undefined,
    appDataDir: SystemPath.getPath("appData") || undefined,
    executablePath,
    winePrefixPath: effectiveWinePrefixPath ?? undefined,
    steamPath,
    storeUserContext,
  };

  let winePrefixIsValid = false;
  if (pathContext.winePrefixPath) {
    try {
      winePrefixIsValid = Wine.validatePrefix(pathContext.winePrefixPath);
    } catch {
      winePrefixIsValid = false;
    }
  }
  const environment = await resolveCloudSaveEnvironment(pathContext, {
    winePrefixIsValid,
    prefixGenerationOverride: overrides?.prefixGenerationOverride,
  });
  if (winePrefixIsValid && environment.prefixIdentityMode !== "marker") {
    logger.warn(
      "[Cloud Save] Wine prefix marker unavailable; using degraded identity",
      { prefixIdentityMode: environment.prefixIdentityMode }
    );
  }

  return { game, ...environment };
};
