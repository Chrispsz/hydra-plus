import { restoreGameSnapshotVersion } from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type { CloudSaveSyncIpcProgressPayload, GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "restoreGameSnapshotVersion",
  async (
    event: Electron.IpcMainInvokeEvent,
    operationId: string,
    objectId: string,
    shop: GameShop,
    version: number
  ) => {
    if (!operationId) {
      throw new Error("Cloud save restore operation ID is required");
    }
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Invalid snapshot version");
    }
    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_restore_game_running");
    }

    return restoreGameSnapshotVersion(objectId, shop, version, (progress) => {
      if (!event.sender.isDestroyed()) {
        const payload: CloudSaveSyncIpcProgressPayload = {
          operationId,
          gameId: { objectId, shop },
          ...progress,
        };
        event.sender.send("on-cloud-save-sync-progress", payload);
      }
    });
  }
);
