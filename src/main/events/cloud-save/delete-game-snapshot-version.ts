import { deleteGameSnapshotVersion } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "deleteGameSnapshotVersion",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    version: number
  ) => {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Invalid snapshot version");
    }
    await deleteGameSnapshotVersion(objectId, shop, version);
  }
);
