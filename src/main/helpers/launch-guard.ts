/**
 * Pure decision core of the launch double-guard and the stale
 * compatibility cleanup skip (F1 stability fixes), extracted verbatim
 * from launch-game.ts so the rules can be chained end-to-end without
 * Electron. The Map instances stay with launch-game.ts: only the
 * decisions live here, parameterized by `now` for deterministic tests.
 */

/**
 * Safety valve: a launch slot that somehow never got released (e.g. a
 * hung promise) is taken over after this long, so the game can never be
 * permanently blocked from launching.
 */
export const ACTIVE_LAUNCH_STALE_MS = 15 * 60_000;
/**
 * The process watcher takes up to one tick (~2s) to match freshly
 * spawned game processes — compatibility cleanup must stay away from a
 * session inside that window.
 */
export const RECENT_LAUNCH_SKIP_MS = 10_000;

export interface LaunchSlotAcquisition {
  acquired: boolean;
  staleTakeover: boolean;
}

/**
 * The double-launch decision: two rapid clicks (or a deep link racing a
 * click) would run the whole pipeline twice and spawn the game twice.
 * A fresh in-flight slot refuses the request; a stale slot is taken over
 * so a leaked guard can never permanently block the game.
 */
export const tryAcquireLaunchSlot = (
  activeMap: Map<string, number>,
  gameKey: string,
  now: number
): LaunchSlotAcquisition => {
  const startedAt = activeMap.get(gameKey);
  if (startedAt !== undefined && now - startedAt < ACTIVE_LAUNCH_STALE_MS) {
    return { acquired: false, staleTakeover: false };
  }

  activeMap.set(gameKey, now);
  return { acquired: true, staleTakeover: startedAt !== undefined };
};

export const releaseLaunchSlot = (
  activeMap: Map<string, number>,
  recentMap: Map<string, number>,
  gameKey: string,
  now: number
): void => {
  activeMap.delete(gameKey);
  // Record completion so compatibility cleanup of the NEXT launch waits
  // for the watcher to catch up with the spawned processes.
  recentMap.set(gameKey, now);
};

/**
 * Never touch the compatibility stack while the game may still be
 * running: killing wineserver mid-session risks a corrupted prefix and
 * in-flight saves. isGameRunning covers watcher-tracked sessions; the
 * recent-launch check covers the window before the first watcher tick
 * has matched the freshly spawned processes.
 */
export const shouldSkipStaleCompatibilityCleanup = ({
  gameRunning,
  lastLaunchAt,
  now,
}: {
  gameRunning: boolean;
  lastLaunchAt: number | undefined;
  now: number;
}): boolean => {
  if (gameRunning) return true;

  return (
    lastLaunchAt !== undefined && now - lastLaunchAt < RECENT_LAUNCH_SKIP_MS
  );
};
