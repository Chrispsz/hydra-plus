import { registerEvent } from "../register-event";
import { ProtonManager } from "@main/services/proton/proton-manager";

const getProtonInstallTargets = async () => {
  return ProtonManager.getInstallTargets();
};

registerEvent("getProtonInstallTargets", getProtonInstallTargets);
