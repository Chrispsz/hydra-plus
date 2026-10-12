import { downloadSourcesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const removeDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  removeAll = false,
  downloadSourceId?: string
) => {
  if (removeAll) {
    await downloadSourcesSublevel.clear();
  } else if (downloadSourceId) {
    await downloadSourcesSublevel.del(downloadSourceId);
  }
};

registerEvent("removeDownloadSource", removeDownloadSource);
