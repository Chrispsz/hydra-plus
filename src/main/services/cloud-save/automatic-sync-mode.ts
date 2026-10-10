import type { CloudSaveAutomaticSyncMode } from "@types";

export type { CloudSaveAutomaticSyncMode } from "@types";

/**
 * Hydra Plus is Drive-only: there is no "legacy" Hydra artifact sync
 * anymore. The stored per-game flag `automaticCloudSync` (the old legacy
 * opt-in) is migrated on read — a game that only had the legacy flag
 * enabled becomes a v2 game, so nobody silently loses automatic sync.
 */
export const resolveCloudSaveAutomaticSyncMode = (
  v2Enabled: boolean
): CloudSaveAutomaticSyncMode => (v2Enabled ? "v2" : "disabled");

export const resolveStoredCloudSaveAutomaticSyncMode = (
  legacyEnabled: boolean,
  storedV2Enabled: boolean | undefined
) => resolveCloudSaveAutomaticSyncMode(storedV2Enabled ?? legacyEnabled);

export const getCloudSaveAutomaticSyncStateForMode = (
  mode: CloudSaveAutomaticSyncMode
): { legacyEnabled: boolean; v2Enabled: boolean } => ({
  legacyEnabled: false,
  v2Enabled: mode === "v2",
});

export const getNextCloudSaveAutomaticSyncMode = (
  currentMode: CloudSaveAutomaticSyncMode,
  targetMode: Exclude<CloudSaveAutomaticSyncMode, "disabled">,
  enabled: boolean
): CloudSaveAutomaticSyncMode => {
  if (enabled) return targetMode;
  return currentMode === targetMode ? "disabled" : currentMode;
};

export const shouldRunV2AutomaticCloudSave = (
  mode: CloudSaveAutomaticSyncMode
) => mode === "v2";
