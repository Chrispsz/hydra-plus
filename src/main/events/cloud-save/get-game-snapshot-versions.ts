import { listGameSnapshotVersions } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getGameSnapshotVersions",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => listGameSnapshotVersions(objectId, shop)
);
