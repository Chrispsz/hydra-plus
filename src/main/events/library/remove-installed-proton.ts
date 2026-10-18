import { registerEvent } from "../register-event";
import { ProtonManager } from "@main/services/proton/proton-manager";

const removeInstalledProton = async (
  _event: Electron.IpcMainInvokeEvent,
  protonPath: string
) => {
  return ProtonManager.removeInstalled(protonPath);
};

registerEvent("removeInstalledProton", removeInstalledProton);
