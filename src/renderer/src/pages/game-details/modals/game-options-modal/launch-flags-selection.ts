import type { LaunchFlagDefinition } from "@shared/launch-flags";

/**
 * Pure selection helpers for the launch flags section of the game options
 * modal. Kept free of React imports so they can be unit-tested with the
 * node test runner (see launch-flags-selection.test.ts).
 */

/**
 * Host tool availability as known by the renderer. Probes reuse the exact
 * channels the compatibility section already uses (`isMangohudAvailable` /
 * `isGamemodeAvailable`).
 *
 * gamescope is intentionally absent: no renderer-side probe is exposed for
 * it yet, so its flag stays enabled and the main process drops the wrapper
 * conservatively at launch time when the tool is missing (follow-up:
 * expose an `isGamescopeAvailable` IPC).
 */
export interface LaunchFlagToolAvailability {
  mangohud: boolean;
  gamemode: boolean;
}

/** Returns the next persisted flag id list after toggling one flag. */
export const toggleLaunchFlagId = (
  currentIds: readonly string[] | null | undefined,
  flagId: string,
  enabled: boolean
): string[] => {
  const current = currentIds ?? [];

  if (!enabled) {
    return current.filter((id) => id !== flagId);
  }

  return current.includes(flagId) ? [...current] : [...current, flagId];
};

/** Whether a flag id is currently persisted as enabled on the game. */
export const isLaunchFlagEnabled = (
  currentIds: readonly string[] | null | undefined,
  flagId: string
): boolean => (currentIds ?? []).includes(flagId);

/**
 * Whether a flag checkbox must render disabled: wrapper flags whose host
 * tool is unavailable (probed the same way the legacy MangoHud/GameMode
 * toggles are). Env flags are always offered — they are inert without
 * their consumer and never break the spawn.
 */
export const isLaunchFlagDisabled = (
  definition: Pick<LaunchFlagDefinition, "availability">,
  availability: LaunchFlagToolAvailability
): boolean => {
  switch (definition.availability) {
    case "mangohud":
      return !availability.mangohud;
    case "gamemode":
      return !availability.gamemode;
    default:
      return false;
  }
};
