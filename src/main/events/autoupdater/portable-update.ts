import {
  applyPortableUpdate,
  downloadPortableUpdate,
  fetchLatestPortableRelease,
  getPortableUpdateState,
} from "@main/services/portable-updater";

import { registerEvent } from "../register-event";

registerEvent("fetchLatestPortableRelease", async () =>
  fetchLatestPortableRelease()
);

registerEvent("getPortableUpdateState", async () => getPortableUpdateState());

registerEvent(
  "downloadPortableUpdate",
  async (event: Electron.IpcMainInvokeEvent) => {
    return downloadPortableUpdate((percent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("on-portable-update-progress", percent);
      }
    });
  }
);

registerEvent("applyPortableUpdate", async () => {
  await applyPortableUpdate();
});
