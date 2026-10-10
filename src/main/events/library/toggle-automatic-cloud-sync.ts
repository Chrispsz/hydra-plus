import { registerEvent } from "../register-event";
import { setCloudSaveAutomaticSyncEnabled } from "@main/services/cloud-save";
import type { GameShop } from "@types";

/**
 * Legacy IPC kept for the existing game-options toggle. Hydra Plus is
 * Drive-only, so this now drives the v2 (Drive snapshot) automatic sync.
 */
const toggleAutomaticCloudSync = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  automaticCloudSync: boolean
) => {
  return setCloudSaveAutomaticSyncEnabled(objectId, shop, automaticCloudSync);
};

registerEvent("toggleAutomaticCloudSync", toggleAutomaticCloudSync);
