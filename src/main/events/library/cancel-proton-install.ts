import { registerEvent } from "../register-event";
import { ProtonManager } from "@main/services/proton/proton-manager";

const cancelProtonInstall = async (
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
  tag: string
) => {
  return ProtonManager.cancelInstall(providerId, tag);
};

registerEvent("cancelProtonInstall", cancelProtonInstall);
