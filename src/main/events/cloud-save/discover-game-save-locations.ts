import { discoverGameSaveLocations } from "@main/services/save-discovery";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "discoverGameSaveLocations",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => discoverGameSaveLocations(objectId, shop)
);
