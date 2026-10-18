import { registerEvent } from "../register-event";
import { ProtonManager } from "@main/services/proton/proton-manager";

const installProtonRelease = async (
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
  tag: string
) => {
  return ProtonManager.installRelease(providerId, tag);
};

registerEvent("installProtonRelease", installProtonRelease);
