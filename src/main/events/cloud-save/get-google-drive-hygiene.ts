import {
  cleanupGoogleDriveTrash,
  deleteGoogleDriveOrphanBlobs,
  getGoogleDriveHygieneOverview,
} from "@main/services/cloud-save";

import { registerEvent } from "../register-event";

registerEvent("getGoogleDriveHygieneOverview", async () =>
  getGoogleDriveHygieneOverview()
);

registerEvent("cleanupGoogleDriveTrash", async () => cleanupGoogleDriveTrash());

registerEvent("deleteGoogleDriveOrphanBlobs", async () =>
  deleteGoogleDriveOrphanBlobs()
);
