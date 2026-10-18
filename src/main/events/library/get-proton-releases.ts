import { registerEvent } from "../register-event";
import { ProtonManager } from "@main/services/proton/proton-manager";

const getProtonReleases = async (
  _event: Electron.IpcMainInvokeEvent,
  providerId: string,
  page?: number
) => {
  return ProtonManager.getReleases(providerId, page ?? 1);
};

registerEvent("getProtonReleases", getProtonReleases);
