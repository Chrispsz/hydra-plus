import { getCloudSaveOverview } from "@main/services/cloud-save";
import { logger } from "@main/services/logger";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "getCloudSaveOverview",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ) => {
    try {
      return await getCloudSaveOverview(objectId, shop);
    } catch (error) {
      // The renderer only shows a generic "could not load" message; the
      // actionable cause (expired Drive grant, keyring failure, native
      // scanner crash…) must live in the logs to be diagnosable.
      logger.error("[Cloud Save] Failed to load overview", {
        shop,
        objectId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
);
