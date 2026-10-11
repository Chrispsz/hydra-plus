import { db, gamesSublevel, levelKeys } from "@main/level";
import type { Game, UserPreferences } from "@types";

import { logger } from "../logger";
import { isGameRunning } from "../game-running-state";
import {
  canRunAutomaticCloudSaveSync,
  runAutomaticCloudSaveSyncDetailed,
} from "./automatic-sync";
import { isCloudSaveDeletionPending } from "./pending-deletion";
import {
  consumeReauthLogState,
  isDriveReauthRequired,
} from "./drive-reauth-state";
import { pruneAutomaticSyncObservations } from "./automatic-sync-observation";

/**
 * Bidirectional background sync.
 *
 * Runs once per minute on the main loop but only performs work when the
 * user's interval (cloudSavePeriodicSyncMinutes, default 30) has elapsed
 * per game. Games that are running are skipped — pre-launch/post-exit
 * handle those.
 */

const DEFAULT_PERIODIC_SYNC_MINUTES = 30;
const lastRunAtByGame = new Map<string, number>();

const gameKey = (objectId: string, shop: Game["shop"]) =>
  JSON.stringify([shop, objectId]);

const resolveIntervalMinutes = async (): Promise<number> => {
  try {
    const preferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );
    const configured = preferences?.cloudSavePeriodicSyncMinutes;
    if (
      typeof configured === "number" &&
      Number.isSafeInteger(configured) &&
      configured >= 0
    ) {
      return configured;
    }
  } catch (error) {
    logger.warn("[Cloud Save] Failed to read periodic sync preference", error);
  }
  return DEFAULT_PERIODIC_SYNC_MINUTES;
};

export const runPeriodicCloudSaveSync = async (): Promise<void> => {
  const intervalMinutes = await resolveIntervalMinutes();
  if (intervalMinutes === 0) return;

  // Circuit breaker: when the Drive refresh token is dead (invalid_grant),
  // stop retrying in the background until the user reconnects. The UI
  // shows the actionable reconnect button; the breaker resets itself as
  // soon as a token refresh succeeds.
  if (isDriveReauthRequired()) {
    if (consumeReauthLogState()) {
      logger.warn(
        "[Cloud Save] Google Drive reauth required — periodic sync paused until reconnect"
      );
    }
    return;
  }

  const now = Date.now();

  try {
    const allGames = (await gamesSublevel.values().all()) as Game[];
    const aliveGameIds = new Set(allGames.map((game) => game.objectId));

    // Evict bookkeeping for games that no longer exist.
    for (const key of [...lastRunAtByGame.keys()]) {
      try {
        const [, objectId] = JSON.parse(key) as [string, string];
        if (!aliveGameIds.has(objectId)) lastRunAtByGame.delete(key);
      } catch {
        lastRunAtByGame.delete(key);
      }
    }
    pruneAutomaticSyncObservations(aliveGameIds);

    for (const game of allGames) {
      const key = gameKey(game.objectId, game.shop);
      const lastRunAt = lastRunAtByGame.get(key) ?? 0;
      if (now - lastRunAt < intervalMinutes * 60_000) continue;
      if (isGameRunning(game.objectId, game.shop)) continue;
      if (await isCloudSaveDeletionPending(game.objectId, game.shop)) continue;

      lastRunAtByGame.set(key, now);

      if (!(await canRunAutomaticCloudSaveSync(game.objectId, game.shop))) {
        continue;
      }

      try {
        const outcome = await runAutomaticCloudSaveSyncDetailed(
          game.objectId,
          game.shop,
          "interval"
        );
        if (outcome.result) {
          logger.log("[Cloud Save] Periodic sync completed", {
            shop: game.shop,
            objectId: game.objectId,
            finalState: outcome.result.finalState,
            action: outcome.result.action,
          });
        }
      } catch (error) {
        logger.warn("[Cloud Save] Periodic sync failed", {
          shop: game.shop,
          objectId: game.objectId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
  } catch (error) {
    logger.warn("[Cloud Save] Periodic sync scan failed", error);
  }
};
