import { WindowManager } from "./window-manager";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import type { Game, UserPreferences } from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { logger, networkLogger } from "./logger";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import path from "node:path";
import { Wine } from "./wine";
import { NativeAddon } from "./native-addon";
import { launchedGamePids } from "./launched-game-pids";
import {
  isValidProcessWatcherScan,
  startOptionalExecutableCatalogueLoad,
} from "./process-watcher-scan";
import {
  doesSteamCompatDataPathMatchWinePrefix,
  hasLaunchedPidMatch,
  hasLinuxNativeOrAppImageMatch,
  type LinuxProcessInfo,
} from "./linux-process-match";
import { isWindowsBatchFile } from "@main/helpers/windows-batch-command";
import { isSteamAppExecutable } from "./steam-integration/steam-library-executable";
import { resolveSteamSessionPlaytimePolicy } from "./steam-integration/steam-playtime";
import {
  getCloudSaveAutomaticSyncMode,
  runAutomaticCloudSavePostExit,
  shouldRunV2AutomaticCloudSave,
} from "./cloud-save";
import {
  clearGamesPlaytimeState,
  deleteGamePlaytime,
  gamesPlaytime,
  getGamePlaytimeDeltas,
  getTrackedGamesRunning,
  setGamePlaytime,
} from "./game-running-state";
import { updateGameRecord } from "./game-record-updater";
import { GameExecutables } from "./game-executables";

export { gamesPlaytime };
export { isGameRunning } from "./game-running-state";

const runAutomaticCloudSaveOnClose = async (game: Game) => {
  const mode = await getCloudSaveAutomaticSyncMode(game.objectId, game.shop);

  if (shouldRunV2AutomaticCloudSave(mode)) {
    await runAutomaticCloudSavePostExit(game.objectId, game.shop);
  }
};

const handleAutomaticCloudSaveLifecycleError = (
  phase: "open" | "close",
  game: Game,
  error: unknown
) => {
  logger.error("[Cloud Save] Automatic lifecycle failed", {
    phase,
    shop: game.shop,
    objectId: game.objectId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  });
};

export const getGamesRunning = () => {
  const now = performance.now();
  return getTrackedGamesRunning(now);
};

const platform = process.platform;

const logPlaytimeTrace = (
  event: string,
  game: Game,
  payload?: Record<string, unknown>
) => {
  networkLogger.info("[playtime-trace]", event, {
    gameKey: levelKeys.game(game.shop, game.objectId),
    shop: game.shop,
    objectId: game.objectId,
    remoteId: game.remoteId,
    localPlayTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
    unsyncedDeltaPlayTimeInMilliseconds:
      game.unsyncedDeltaPlayTimeInMilliseconds ?? 0,
    countHydraPlaytime: gamesPlaytime.get(
      levelKeys.game(game.shop, game.objectId)
    )?.countHydraPlaytime,
    lastTimePlayed:
      game.lastTimePlayed instanceof Date
        ? game.lastTimePlayed.toISOString()
        : game.lastTimePlayed,
    ...payload,
  });
};

void GameExecutables.ensureLoaded();

const findGamePathByProcess = async (
  processMap: Map<string, Set<string>>,
  winePrefixMap: Map<string, string>,
  gameId: string
) => {
  const executables = GameExecutables.getExecutablesForGame(gameId);
  if (!executables) return;

  for (const executable of executables) {
    const executablewithoutExtension = executable.exe.replace(/\.exe$/i, "");

    const pathSet =
      processMap.get(executable.exe) ??
      processMap.get(executablewithoutExtension);

    if (pathSet) {
      for (const path of pathSet) {
        if (
          path.toLowerCase().endsWith(executable.name) ||
          path.toLowerCase().endsWith(executablewithoutExtension)
        ) {
          const gameKey = levelKeys.game("steam", gameId);
          const game = await gamesSublevel.get(gameKey);

          if (game) {
            const updatedGame: Game = {
              ...updateGameExecutablePath(game, path),
            };

            if (process.platform === "linux" && winePrefixMap.has(path)) {
              updatedGame.winePrefixPath = winePrefixMap.get(path)!;
            }

            await gamesSublevel.put(gameKey, updatedGame);
            logger.info("Set game path", gameKey, path);
          }
        }
      }
    }
  }
};

const getSystemProcessMap = async () => {
  const result = await NativeAddon.getSystemProcessMap();
  if (result === null) return null;

  const {
    processMap: rawMap,
    winePrefixMap: rawWineMap,
    linuxProcesses,
  } = result;

  const processMap = new Map<string, Set<string>>(
    Object.entries(rawMap).map(([k, v]) => [k, new Set(v)])
  );

  const winePrefixMap = new Map<string, string>(Object.entries(rawWineMap));

  return { processMap, winePrefixMap, linuxProcesses };
};

// Do not restore an old import flag or executable after an asynchronous sync.
const persistGamePlaytime = async (
  gameKey: string,
  update: Partial<
    Pick<
      Game,
      | "playTimeInMilliseconds"
      | "lastTimePlayed"
      | "unsyncedDeltaPlayTimeInMilliseconds"
    >
  >
) => {
  await updateGameRecord(gameKey, update);
};

const hasLinuxCompatibilityProcessMatch = (
  game: Game,
  executablePath: string,
  linuxProcesses: LinuxProcessInfo[]
) => {
  if (path.extname(executablePath).toLowerCase() !== ".exe") {
    return false;
  }

  const executableName = path.basename(executablePath).toLowerCase();
  const executableNameWithoutExtension = executableName.replace(/\.exe$/i, "");
  const executableDirectory = path.dirname(executablePath).toLowerCase();
  const expectedWinePrefix = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    game.objectId
  )?.toLowerCase();

  return linuxProcesses.some((process) => {
    if (process.cwd !== executableDirectory) {
      return false;
    }

    if (
      expectedWinePrefix &&
      process.steamCompatDataPath &&
      !doesSteamCompatDataPathMatchWinePrefix(
        process.steamCompatDataPath,
        expectedWinePrefix
      )
    ) {
      return false;
    }

    if (
      process.name === executableName ||
      process.name === executableNameWithoutExtension
    ) {
      return true;
    }

    const processRunsUnderWine = process.exe.includes("wine");

    return processRunsUnderWine && process.name.length > 0;
  });
};

/**
 * The watcher ticks every 2 seconds and only needs the library for
 * name matching. A 10-second TTL cache turns 30 full LevelDB sublevel
 * scans per minute into 6, without any visible staleness for the user.
 */
const WATCHED_GAMES_CACHE_TTL_MS = 10_000;
let watchedGamesCache: { at: number; games: Game[] } | null = null;

const getWatchedGamesCached = async (): Promise<Game[]> => {
  if (
    watchedGamesCache &&
    Date.now() - watchedGamesCache.at < WATCHED_GAMES_CACHE_TTL_MS
  ) {
    return watchedGamesCache.games;
  }
  const games = ((await gamesSublevel.values().all()) as Game[]).filter(
    (game) => game.isDeleted === false
  );
  watchedGamesCache = { at: Date.now(), games };
  return games;
};

export const watchProcesses = async () => {
  startOptionalExecutableCatalogueLoad(() => GameExecutables.ensureLoaded());

  const games = await getWatchedGamesCached();

  if (!games.length) return;

  const systemProcessMap = await getSystemProcessMap();
  if (!isValidProcessWatcherScan(systemProcessMap)) {
    logger.warn("Process enumeration failed; skipping process watcher tick");
    return;
  }
  const { processMap, winePrefixMap, linuxProcesses } = systemProcessMap;

  const pidToProcess = new Map<number, LinuxProcessInfo>(
    linuxProcesses.map((process) => [process.pid, process])
  );

  for (const game of games) {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    const executablePath = game.executablePath;
    if (!executablePath) {
      if (GameExecutables.getExecutablesForGame(game.objectId)) {
        await findGamePathByProcess(processMap, winePrefixMap, game.objectId);
      }

      continue;
    }

    const trackingPaths = game.trackingExecutablePaths?.filter(Boolean) ?? [];

    let matchPaths: string[];
    if (isWindowsBatchFile(executablePath)) {
      matchPaths = trackingPaths.length ? trackingPaths : [executablePath];
    } else {
      matchPaths = [executablePath, ...trackingPaths];
    }

    let matchedPath = matchPaths.find((matchPath) => {
      const executable = matchPath
        .slice(matchPath.lastIndexOf(platform === "win32" ? "\\" : "/") + 1)
        .toLowerCase();

      if (processMap.get(executable)?.has(matchPath)) return true;

      if (platform === "linux") {
        return (
          hasLinuxNativeOrAppImageMatch(matchPath, linuxProcesses) ||
          hasLinuxCompatibilityProcessMatch(game, matchPath, linuxProcesses)
        );
      }

      return false;
    });

    if (
      !matchedPath &&
      platform === "linux" &&
      hasLaunchedPidMatch(
        launchedGamePids.get(gameKey),
        executablePath,
        pidToProcess
      )
    ) {
      matchedPath = executablePath;
    }

    if (matchedPath) {
      if (gamesPlaytime.has(gameKey)) {
        onTickGame(game);
      } else {
        await onOpenGame(game, matchedPath);
      }
    } else if (gamesPlaytime.has(gameKey)) {
      await onCloseGame(game);
    }
  }

  WindowManager.sendToAppWindows("on-games-running", getGamesRunning());
};

async function onOpenGame(game: Game, matchedPath: string) {
  const now = performance.now();
  const gameKey = levelKeys.game(game.shop, game.objectId);
  let countHydraPlaytime = true;

  if (game.shop === "steam") {
    const isSteamLibraryPath = await isSteamAppExecutable(
      game.objectId,
      matchedPath
    );

    ({ countHydraPlaytime } = resolveSteamSessionPlaytimePolicy({
      hasActiveSteamImport: game.hasActiveSteamImport === true,
      isSteamLibraryPath,
      enableHydraPlaytimeTracking: game.enableHydraPlaytimeTracking === true,
    }));
  }

  setGamePlaytime(gameKey, {
    lastTick: now,
    firstTick: now,
    lastSyncTick: now,
    countHydraPlaytime,
    syncSteamOnExit: false,
  });

  logPlaytimeTrace("session-open", game, {
    performanceNow: now,
    matchedPath,
  });

  // On Linux, keep the launcher visible briefly and let it auto-close itself.
  if (process.platform !== "linux") {
    WindowManager.closeGameLauncherWindow();
  }

  // Hide Hydra to tray on game startup if enabled
  db.get<string, UserPreferences | null>(levelKeys.userPreferences, {
    valueEncoding: "json",
  })
    .then((userPreferences) => {
      if (userPreferences?.hideToTrayOnGameStart) {
        WindowManager.mainWindow?.hide();
      }
    })
    .catch(() => {});

  if (game.shop === "custom") return;
}

function onTickGame(game: Game) {
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(
    levelKeys.game(game.shop, game.objectId)
  )!;

  const { localDelta: delta } = getGamePlaytimeDeltas(
    gamePlaytime,
    now,
    game.unsyncedDeltaPlayTimeInMilliseconds ?? 0
  );

  const updatedGame = {
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  };

  void persistGamePlaytime(
    levelKeys.game(game.shop, game.objectId),
    updatedGame
  ).catch((error: unknown) => {
    logger.error("Failed to persist game playtime tick", {
      gameKey: levelKeys.game(game.shop, game.objectId),
      error,
    });
  });

  setGamePlaytime(levelKeys.game(game.shop, game.objectId), {
    ...gamePlaytime,
    lastTick: now,
  });
}

const onCloseGame = async (game: Game) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(gameKey)!;
  deleteGamePlaytime(gameKey);
  launchedGamePids.delete(gameKey);
  PowerSaveBlockerManager.markGameClosed(gameKey);

  const { localDelta: delta } = getGamePlaytimeDeltas(
    gamePlaytime,
    now,
    game.unsyncedDeltaPlayTimeInMilliseconds ?? 0
  );

  logPlaytimeTrace("session-close", game, {
    performanceNow: now,
    delta,
    firstTick: gamePlaytime.firstTick,
    lastTick: gamePlaytime.lastTick,
    lastSyncTick: gamePlaytime.lastSyncTick,
    countHydraPlaytime: gamePlaytime.countHydraPlaytime,
  });

  const updatedGame = {
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  };

  // Awaited so the quit path (clearGamesPlaytime) flushes the final
  // playtime of the session before the app exits.
  try {
    await persistGamePlaytime(gameKey, updatedGame);
  } catch (error) {
    logger.error("Failed to persist final game playtime", {
      gameKey,
      error,
    });
  }

  if (game.shop === "custom") return;

  void runAutomaticCloudSaveOnClose(game).catch((error: unknown) => {
    handleAutomaticCloudSaveLifecycleError("close", game, error);
  });
};

export const clearGamesPlaytime = async () => {
  for (const game of gamesPlaytime.keys()) {
    const gameData = await gamesSublevel.get(game);

    if (gameData) {
      await onCloseGame(gameData);
    }
  }

  clearGamesPlaytimeState();
};
