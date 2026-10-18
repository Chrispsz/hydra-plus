import { registerEvent } from "../register-event";
import { ProtonManager } from "@main/services/proton/proton-manager";

const getProtonProviders = async () => {
  return ProtonManager.getProviders();
};

registerEvent("getProtonProviders", getProtonProviders);
